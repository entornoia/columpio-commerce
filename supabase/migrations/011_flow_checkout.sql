-- BLOQUE 4C: checkout Flow persistente e idempotente. No confirma pagos ni modifica stock.
create table if not exists public.commerce_flow_checkouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  provider text not null default 'flow' check (provider = 'flow'),
  status text not null default 'creating' check (status in ('creating', 'ready', 'failed', 'uncertain')),
  payer_email text not null,
  flow_order bigint,
  flow_token text,
  payment_url text,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, order_id),
  unique (flow_order),
  unique (flow_token),
  check (payer_email = lower(trim(payer_email)) and payer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check ((status = 'ready' and flow_order is not null and flow_token is not null and payment_url is not null)
    or status <> 'ready')
);

create index if not exists commerce_flow_checkouts_order_idx
  on public.commerce_flow_checkouts(order_id, created_at desc);

drop trigger if exists commerce_flow_checkouts_updated_at on public.commerce_flow_checkouts;
create trigger commerce_flow_checkouts_updated_at
  before update on public.commerce_flow_checkouts
  for each row execute function public.set_updated_at();

create or replace function public.claim_flow_checkout(
  p_external_user_id text,
  p_payer_email text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.commerce_orders%rowtype;
  v_checkout public.commerce_flow_checkouts%rowtype;
  v_claim_token uuid := gen_random_uuid();
  v_email text := lower(trim(p_payer_email));
  v_owned boolean := false;
  v_items jsonb;
  v_item_sum numeric(14,2);
begin
  select o.* into v_order
  from public.commerce_orders o
  join public.instagram_conversations ic on ic.id = o.conversation_id
  where ic.channel = 'instagram' and ic.external_user_id = p_external_user_id
  order by o.created_at desc
  limit 1;

  if v_order.id is null then raise exception 'Order not found'; end if;
  if v_order.status = 'cancelled' then raise exception 'Order cancelled'; end if;
  if v_order.status <> 'pending_payment' then raise exception 'Order is not pending payment'; end if;
  if v_order.currency <> 'CLP' then raise exception 'Order currency must be CLP'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'orderItemId', oi.id,
      'productId', oi.product_id,
      'variantId', oi.variant_id,
      'productName', oi.product_name,
      'productSku', oi.product_sku,
      'variantSku', oi.variant_sku,
      'color', oi.color,
      'size', oi.size,
      'quantity', oi.quantity,
      'unitPrice', oi.unit_price,
      'subtotal', oi.subtotal
    ) order by oi.created_at), '[]'::jsonb), coalesce(sum(oi.subtotal), 0)
  into v_items, v_item_sum
  from public.commerce_order_items oi where oi.order_id = v_order.id;

  if jsonb_array_length(v_items) = 0 then raise exception 'Order has no items'; end if;
  if exists (
    select 1 from public.commerce_order_items oi
    where oi.order_id = v_order.id
      and (oi.quantity < 1 or oi.unit_price < 1 or oi.subtotal <> oi.quantity * oi.unit_price)
  ) then raise exception 'Order item is invalid'; end if;
  if v_item_sum <> v_order.subtotal then raise exception 'Order item subtotal mismatch'; end if;
  if v_order.subtotal <> v_order.total then raise exception 'Order total mismatch'; end if;

  select * into v_checkout
  from public.commerce_flow_checkouts
  where provider = 'flow' and order_id = v_order.id
  for update;

  if v_checkout.id is null then
    if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      return jsonb_build_object(
        'status', 'payer_email_required',
        'orderId', v_order.id,
        'orderNumber', v_order.order_number,
        'orderStatus', v_order.status,
        'currency', v_order.currency,
        'subtotal', v_order.subtotal,
        'total', v_order.total,
        'items', v_items
      );
    end if;

    insert into public.commerce_flow_checkouts(order_id, payer_email, claim_token, claimed_at)
    values(v_order.id, v_email, v_claim_token, now())
    on conflict(provider, order_id) do nothing
    returning * into v_checkout;

    if v_checkout.id is not null then
      v_owned := true;
    else
      select * into v_checkout
      from public.commerce_flow_checkouts
      where provider = 'flow' and order_id = v_order.id
      for update;
    end if;
  elsif v_checkout.status = 'failed' then
    update public.commerce_flow_checkouts
    set status = 'creating', claim_token = v_claim_token, claimed_at = now(), last_error_code = null
    where id = v_checkout.id
    returning * into v_checkout;
    v_owned := true;
  elsif v_checkout.status = 'creating' and v_checkout.claimed_at < now() - interval '2 minutes' then
    -- Un claim abandonado se vuelve incierto: pudo alcanzar a Flow antes de caer el proceso.
    update public.commerce_flow_checkouts
    set status = 'uncertain', last_error_code = 'stale_claim'
    where id = v_checkout.id
    returning * into v_checkout;
  end if;

  return jsonb_build_object(
    'status', case
      when v_checkout.status = 'ready' then 'payment_link_ready'
      when v_checkout.status = 'uncertain' then 'payment_link_uncertain'
      when v_owned then 'payment_link_claimed'
      else 'payment_link_processing'
    end,
    'claimOwned', v_owned,
    'claimId', v_checkout.id,
    'claimToken', case when v_owned then v_checkout.claim_token else null end,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'orderStatus', v_order.status,
    'currency', v_order.currency,
    'subtotal', v_order.subtotal,
    'total', v_order.total,
    'items', v_items,
    'payerEmail', v_checkout.payer_email,
    'flowOrder', v_checkout.flow_order,
    'flowToken', case when v_checkout.status = 'ready' then v_checkout.flow_token else null end,
    'paymentUrl', v_checkout.payment_url
  );
end;
$$;

create or replace function public.complete_flow_checkout(
  p_claim_id uuid,
  p_claim_token uuid,
  p_flow_order bigint,
  p_flow_token text,
  p_payment_url text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.commerce_flow_checkouts%rowtype;
begin
  if p_flow_order is null or p_flow_order < 1
    or p_flow_token is null or length(trim(p_flow_token)) = 0
    or p_payment_url is null or length(trim(p_payment_url)) = 0 then
    raise exception 'Invalid Flow checkout response';
  end if;

  update public.commerce_flow_checkouts
  set status = 'ready', flow_order = p_flow_order, flow_token = p_flow_token,
      payment_url = p_payment_url, last_error_code = null
  where id = p_claim_id and claim_token = p_claim_token and status = 'creating'
  returning * into v_row;

  if v_row.id is null then raise exception 'Flow checkout claim lost'; end if;
  return jsonb_build_object(
    'status', 'payment_link_ready',
    'flowOrder', v_row.flow_order,
    'flowToken', v_row.flow_token,
    'paymentUrl', v_row.payment_url,
    'payerEmail', v_row.payer_email
  );
end;
$$;

create or replace function public.fail_flow_checkout(
  p_claim_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_uncertain boolean default false
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.commerce_flow_checkouts
  set status = case when p_uncertain then 'uncertain' else 'failed' end,
      last_error_code = left(coalesce(p_error_code, 'unknown'), 100)
  where id = p_claim_id and claim_token = p_claim_token and status = 'creating';
end;
$$;

alter table public.commerce_flow_checkouts enable row level security;
revoke all on table public.commerce_flow_checkouts from public, anon, authenticated;
grant select, insert, update on table public.commerce_flow_checkouts to service_role;

revoke all on function public.claim_flow_checkout(text,text),
  public.complete_flow_checkout(uuid,uuid,bigint,text,text),
  public.fail_flow_checkout(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_flow_checkout(text,text),
  public.complete_flow_checkout(uuid,uuid,bigint,text,text),
  public.fail_flow_checkout(uuid,uuid,text,boolean) to service_role;

comment on table public.commerce_flow_checkouts is
  'Checkout Flow por pedido. No confirma pagos ni modifica commerce_orders o stock.';
