begin;

create table public.web_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.web_orders(id) on delete restrict,
  provider text not null default 'flow' check (provider = 'flow'),
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled','expired','uncertain','refund_pending','refunded')),
  amount numeric(12,0) not null check (amount > 0),
  currency text not null default 'CLP' check (currency = 'CLP'),
  stock_exception boolean not null default false,
  stock_exception_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stock_exception and stock_exception_at is not null and status = 'paid') or (not stock_exception and stock_exception_at is null))
);

create table public.web_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.web_payments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  idempotency_key uuid not null,
  status text not null default 'creating' check (status in ('creating','ready','pending','paid','failed','cancelled','expired','uncertain')),
  provider_order_id bigint unique,
  commerce_order text not null unique,
  flow_token text unique,
  payment_url text,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, attempt_number),
  unique (payment_id, idempotency_key),
  check (flow_token is null or flow_token ~ '^[A-Za-z0-9_-]+$'),
  check ((status in ('ready','pending','paid') and provider_order_id is not null and flow_token is not null and payment_url is not null) or status not in ('ready','pending','paid'))
);

create table public.web_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.web_payments(id) on delete restrict,
  attempt_id uuid not null references public.web_payment_attempts(id) on delete restrict,
  provider text not null default 'flow' check (provider = 'flow'),
  event_type text not null check (event_type in ('pending','approved','failed','cancelled','paid_stock_exception')),
  provider_status text not null,
  payload jsonb not null,
  payload_hash text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, payload_hash),
  check (payload_hash ~ '^[a-f0-9]{64}$')
);

create index web_payment_attempts_payment_idx on public.web_payment_attempts(payment_id, created_at desc);
create index web_payment_events_payment_idx on public.web_payment_events(payment_id, received_at desc);
create index web_payments_status_idx on public.web_payments(status, created_at);

create trigger web_payments_updated_at before update on public.web_payments for each row execute function public.set_updated_at();
create trigger web_payment_attempts_updated_at before update on public.web_payment_attempts for each row execute function public.set_updated_at();

alter table public.web_payments enable row level security;
alter table public.web_payment_attempts enable row level security;
alter table public.web_payment_events enable row level security;
revoke all on table public.web_payments, public.web_payment_attempts, public.web_payment_events from public, anon, authenticated;
grant select, insert, update, delete on table public.web_payments, public.web_payment_attempts, public.web_payment_events to service_role;

create or replace function public.claim_web_flow_payment(p_token_hash text, p_order_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  selected_session public.web_sessions%rowtype;
  selected_order public.web_orders%rowtype;
  selected_reservation public.web_stock_reservations%rowtype;
  selected_payment public.web_payments%rowtype;
  selected_attempt public.web_payment_attempts%rowtype;
  selected_email text;
  next_attempt integer;
  claim_owned boolean := false;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_order_id is null or p_idempotency_key is null then raise exception 'Invalid payment identity'; end if;
  select * into selected_session from public.web_sessions where token_hash=p_token_hash and status='active' and expires_at>now() for update;
  if not found then raise exception 'Payment session not found'; end if;
  select * into selected_order from public.web_orders where id=p_order_id and session_id=selected_session.id for update;
  if not found then raise exception 'Order not found'; end if;
  if selected_order.status <> 'pending_payment' or selected_order.currency <> 'CLP' or selected_order.total <= 0 then raise exception 'Order is not payable'; end if;
  if selected_order.total <> selected_order.items_subtotal-selected_order.discount_total+selected_order.shipping_total then raise exception 'Order total mismatch'; end if;
  if selected_order.items_subtotal <> (select coalesce(sum(item.line_subtotal),0) from public.web_order_items item where item.order_id=selected_order.id) then raise exception 'Order item total mismatch'; end if;
  select * into selected_reservation from public.web_stock_reservations where order_id=selected_order.id for update;
  if not found or selected_reservation.status <> 'active' or selected_reservation.expires_at <= now() then raise exception 'Order reservation expired'; end if;
  select customer.email into selected_email from public.web_order_customers customer where customer.order_id=selected_order.id;

  insert into public.web_payments(order_id,amount,currency) values(selected_order.id,selected_order.total,selected_order.currency)
  on conflict(order_id) do nothing;
  select * into selected_payment from public.web_payments where order_id=selected_order.id for update;
  if selected_payment.amount <> selected_order.total or selected_payment.currency <> selected_order.currency or selected_payment.provider <> 'flow' then raise exception 'Payment snapshot mismatch'; end if;

  select * into selected_attempt from public.web_payment_attempts where payment_id=selected_payment.id and idempotency_key=p_idempotency_key;
  if not found then
    select * into selected_attempt from public.web_payment_attempts where payment_id=selected_payment.id and status in ('creating','ready','pending','uncertain') order by attempt_number desc limit 1;
  end if;
  if not found then
    select coalesce(max(attempt_number),0)+1 into next_attempt from public.web_payment_attempts where payment_id=selected_payment.id;
    insert into public.web_payment_attempts(payment_id,attempt_number,idempotency_key,commerce_order)
    values(selected_payment.id,next_attempt,p_idempotency_key,case when next_attempt=1 then selected_order.order_number else selected_order.order_number||'-A'||next_attempt end)
    returning * into selected_attempt;
    claim_owned := true;
    update public.web_payments set status='pending',failed_at=null where id=selected_payment.id;
  end if;
  return jsonb_build_object(
    'paymentId',selected_payment.id,'attemptId',selected_attempt.id,'claimToken',case when selected_attempt.status='creating' then selected_attempt.claim_token end,
    'claimOwned',claim_owned,
    'attemptStatus',selected_attempt.status,'orderId',selected_order.id,'orderNumber',selected_order.order_number,'commerceOrder',selected_attempt.commerce_order,
    'amount',selected_payment.amount,'currency',selected_payment.currency,'email',selected_email,'paymentUrl',selected_attempt.payment_url
  );
end;
$$;
alter function public.claim_web_flow_payment(text,uuid,uuid) owner to postgres;
revoke all on function public.claim_web_flow_payment(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_web_flow_payment(text,uuid,uuid) to service_role;

create or replace function public.complete_web_flow_payment_attempt(p_attempt_id uuid,p_claim_token uuid,p_provider_order_id bigint,p_flow_token text,p_payment_url text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare selected_attempt public.web_payment_attempts%rowtype;
begin
  if p_provider_order_id is null or p_provider_order_id<1 or p_flow_token is null or p_flow_token!~'^[A-Za-z0-9_-]+$' or nullif(trim(p_payment_url),'') is null then raise exception 'Invalid Flow response'; end if;
  update public.web_payment_attempts set status='ready',provider_order_id=p_provider_order_id,flow_token=p_flow_token,payment_url=p_payment_url,error_code=null,error_message=null
  where id=p_attempt_id and claim_token=p_claim_token and status='creating' returning * into selected_attempt;
  if not found then raise exception 'Payment attempt claim lost'; end if;
  return jsonb_build_object('attemptId',selected_attempt.id,'status',selected_attempt.status,'paymentUrl',selected_attempt.payment_url);
end;
$$;
alter function public.complete_web_flow_payment_attempt(uuid,uuid,bigint,text,text) owner to postgres;
revoke all on function public.complete_web_flow_payment_attempt(uuid,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.complete_web_flow_payment_attempt(uuid,uuid,bigint,text,text) to service_role;

create or replace function public.fail_web_flow_payment_attempt(p_attempt_id uuid,p_claim_token uuid,p_error_code text,p_error_message text,p_uncertain boolean default false)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.web_payment_attempts set status=case when p_uncertain then 'uncertain' else 'failed' end,error_code=left(coalesce(p_error_code,'unknown'),100),error_message=left(coalesce(p_error_message,'Flow request failed'),240)
  where id=p_attempt_id and claim_token=p_claim_token and status='creating';
  update public.web_payments payment set status=case when p_uncertain then 'uncertain' else 'failed' end,failed_at=case when p_uncertain then null else now() end
  where payment.id=(select attempt.payment_id from public.web_payment_attempts attempt where attempt.id=p_attempt_id);
end;
$$;
alter function public.fail_web_flow_payment_attempt(uuid,uuid,text,text,boolean) owner to postgres;
revoke all on function public.fail_web_flow_payment_attempt(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.fail_web_flow_payment_attempt(uuid,uuid,text,text,boolean) to service_role;

create or replace function public.get_web_flow_callback_context(p_flow_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('found',true,'attemptId',attempt.id,'paymentId',payment.id,'orderId',orders.id,'providerOrderId',attempt.provider_order_id,'commerceOrder',attempt.commerce_order,'amount',payment.amount,'currency',payment.currency)
  from public.web_payment_attempts attempt join public.web_payments payment on payment.id=attempt.payment_id join public.web_orders orders on orders.id=payment.order_id
  where attempt.flow_token=p_flow_token;
$$;
alter function public.get_web_flow_callback_context(text) owner to postgres;
revoke all on function public.get_web_flow_callback_context(text) from public,anon,authenticated;
grant execute on function public.get_web_flow_callback_context(text) to service_role;

create or replace function public.process_web_flow_event(p_flow_token text,p_provider_order_id bigint,p_commerce_order text,p_provider_status integer,p_currency text,p_amount numeric,p_payload_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  selected_attempt public.web_payment_attempts%rowtype; selected_payment public.web_payments%rowtype; selected_order public.web_orders%rowtype; selected_reservation public.web_stock_reservations%rowtype;
  created_event public.web_payment_events%rowtype; variant_ids uuid[]; reservation_is_current boolean; stock_available boolean;
begin
  if p_flow_token is null or p_flow_token!~'^[A-Za-z0-9_-]+$' or p_provider_order_id<1 or p_provider_status not in (1,2,3,4) or p_payload_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid Flow event'; end if;
  select * into selected_attempt from public.web_payment_attempts where flow_token=p_flow_token for update;
  if not found then return jsonb_build_object('handled',false,'reason','not_web_payment'); end if;
  select * into selected_payment from public.web_payments where id=selected_attempt.payment_id for update;
  select * into selected_order from public.web_orders where id=selected_payment.order_id for update;
  select * into selected_reservation from public.web_stock_reservations where order_id=selected_order.id for update;
  if selected_attempt.provider_order_id<>p_provider_order_id or selected_attempt.commerce_order<>p_commerce_order or selected_payment.amount<>p_amount or selected_payment.currency<>p_currency then raise exception 'Flow payment verification mismatch'; end if;
  insert into public.web_payment_events(payment_id,attempt_id,event_type,provider_status,payload,payload_hash)
  values(selected_payment.id,selected_attempt.id,case p_provider_status when 1 then 'pending' when 2 then 'approved' when 3 then 'failed' else 'cancelled' end,p_provider_status::text,
    jsonb_build_object('flowOrder',p_provider_order_id,'commerceOrder',p_commerce_order,'status',p_provider_status,'currency',p_currency,'amount',p_amount),p_payload_hash)
  on conflict(provider,payload_hash) do nothing returning * into created_event;
  if not found then return jsonb_build_object('handled',true,'duplicate',true,'orderStatus',selected_order.status); end if;

  if p_provider_status=2 then
    if selected_payment.status='paid' and not selected_payment.stock_exception then
      update public.web_payment_events set processed_at=now() where id=created_event.id;
      return jsonb_build_object('handled',true,'duplicate',true,'orderStatus',selected_order.status);
    end if;
    select array_agg(item.variant_id order by item.variant_id) into variant_ids from public.web_stock_reservation_items item where item.reservation_id=selected_reservation.id;
    perform * from public.lock_web_stock_variants(variant_ids);
    reservation_is_current := selected_reservation.status='active' and selected_reservation.expires_at>now();
    if reservation_is_current then
      stock_available := not exists(select 1 from public.web_stock_reservation_items item join public.product_variants variant on variant.id=item.variant_id where item.reservation_id=selected_reservation.id and variant.stock<item.quantity);
    else
      stock_available := not exists(select 1 from public.web_stock_reservation_items item where item.reservation_id=selected_reservation.id and public.web_variant_available_stock(item.variant_id)<item.quantity);
    end if;
    if stock_available then
      update public.product_variants variant set stock=variant.stock-item.quantity from public.web_stock_reservation_items item where item.reservation_id=selected_reservation.id and variant.id=item.variant_id and variant.stock>=item.quantity;
      if not found then raise exception 'Stock consumption failed'; end if;
      update public.web_stock_reservations set status='consumed',consumed_at=now(),released_at=null,release_reason=null where id=selected_reservation.id;
      update public.web_payments set status='paid',paid_at=coalesce(paid_at,now()),failed_at=null,stock_exception=false,stock_exception_at=null where id=selected_payment.id;
      update public.web_payment_attempts set status='paid' where id=selected_attempt.id;
      update public.web_orders set status='paid',paid_at=coalesce(paid_at,now()) where id=selected_order.id;
      update public.web_carts set status='converted',converted_at=now() where id=selected_order.source_cart_id;
    else
      if selected_reservation.status='active' then update public.web_stock_reservations set status='expired',released_at=now(),release_reason='paid_after_stock_unavailable' where id=selected_reservation.id; end if;
      update public.web_payments set status='paid',paid_at=coalesce(paid_at,now()),stock_exception=true,stock_exception_at=coalesce(stock_exception_at,now()) where id=selected_payment.id;
      update public.web_payment_attempts set status='paid' where id=selected_attempt.id;
      update public.web_orders set status='payment_review' where id=selected_order.id;
      update public.web_payment_events set event_type='paid_stock_exception' where id=created_event.id;
    end if;
  elsif p_provider_status=1 then
    update public.web_payments set status='pending' where id=selected_payment.id and status not in ('paid','refunded');
    update public.web_payment_attempts set status='pending' where id=selected_attempt.id and status not in ('paid','cancelled','failed');
  else
    update public.web_payments set status=case when p_provider_status=3 then 'failed' else 'cancelled' end,failed_at=case when p_provider_status=3 then now() else failed_at end where id=selected_payment.id and status<>'paid';
    update public.web_payment_attempts set status=case when p_provider_status=3 then 'failed' else 'cancelled' end where id=selected_attempt.id and status<>'paid';
    update public.web_orders set status=case when p_provider_status=3 then 'payment_failed' else 'cancelled' end,cancelled_at=case when p_provider_status=4 then now() else cancelled_at end where id=selected_order.id and status='pending_payment';
    if selected_reservation.status='active' then update public.web_stock_reservations set status='released',released_at=now(),release_reason=case when p_provider_status=3 then 'flow_failed' else 'flow_cancelled' end where id=selected_reservation.id; end if;
    -- El carrito permanece checkout: source_cart_id es único y reabrirlo lo dejaría
    -- mutable pero incapaz de crear un pedido nuevo de forma coherente.
  end if;
  update public.web_payment_events set processed_at=now() where id=created_event.id;
  return jsonb_build_object('handled',true,'duplicate',false,'orderStatus',(select status from public.web_orders where id=selected_order.id),'paymentStatus',(select status from public.web_payments where id=selected_payment.id));
end;
$$;
alter function public.process_web_flow_event(text,bigint,text,integer,text,numeric,text) owner to postgres;
revoke all on function public.process_web_flow_event(text,bigint,text,integer,text,numeric,text) from public,anon,authenticated;
grant execute on function public.process_web_flow_event(text,bigint,text,integer,text,numeric,text) to service_role;

create or replace function public.expire_web_pending_payments(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare affected integer;
begin
  if p_limit not between 1 and 500 then raise exception 'Invalid reconciliation limit'; end if;
  with candidates as (select orders.id from public.web_orders orders join public.web_stock_reservations reservation on reservation.order_id=orders.id where orders.status='pending_payment' and reservation.status='active' and reservation.expires_at<=now() order by reservation.expires_at for update of orders,reservation skip locked limit p_limit),
  expired_reservations as (update public.web_stock_reservations reservation set status='expired',released_at=now(),release_reason='payment_timeout' from candidates where reservation.order_id=candidates.id returning reservation.order_id)
  update public.web_orders orders set status='expired',expired_at=now() from expired_reservations expired where orders.id=expired.order_id;
  get diagnostics affected=row_count;
  update public.web_payments payment set status='expired' where payment.order_id in (select orders.id from public.web_orders orders where orders.status='expired') and payment.status='pending';
  update public.web_payment_attempts attempt set status='expired' from public.web_payments payment where payment.id=attempt.payment_id and payment.status='expired' and attempt.status in ('creating','ready','pending');
  return affected;
end;
$$;
alter function public.expire_web_pending_payments(integer) owner to postgres;
revoke all on function public.expire_web_pending_payments(integer) from public,anon,authenticated;
grant execute on function public.expire_web_pending_payments(integer) to service_role;

create or replace function public.get_web_payment_result(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('orderNumber',orders.order_number,'orderStatus',orders.status,'paymentStatus',coalesce(payment.status,'pending'),'total',orders.total,'currency',orders.currency,'stockException',coalesce(payment.stock_exception,false))
  from public.web_sessions session join public.web_orders orders on orders.session_id=session.id left join public.web_payments payment on payment.order_id=orders.id
  where session.token_hash=p_token_hash and session.status='active' and session.expires_at>now()
  order by orders.created_at desc limit 1;
$$;
alter function public.get_web_payment_result(text) owner to postgres;
revoke all on function public.get_web_payment_result(text) from public,anon,authenticated;
grant execute on function public.get_web_payment_result(text) to service_role;

comment on table public.web_payments is 'Pagos web; no reutiliza commerce_* de Instagram.';
comment on column public.web_payments.stock_exception is 'Pago recibido sin stock readquirible; requiere revisión humana y nunca descuenta stock negativo.';

commit;
