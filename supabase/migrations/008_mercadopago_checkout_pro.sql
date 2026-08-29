-- BLOQUE 4C: preferencias persistentes de Mercado Pago Checkout Pro.
create table if not exists public.commerce_payment_preferences (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  status text not null default 'creating' check (status in ('creating', 'ready', 'failed')),
  provider_preference_id text,
  init_point text,
  sandbox_init_point text,
  claim_token uuid not null default gen_random_uuid(),
  claimed_at timestamptz not null default now(),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, order_id),
  unique (provider, provider_preference_id),
  check ((status = 'ready' and provider_preference_id is not null and init_point is not null)
    or status <> 'ready')
);

create index if not exists commerce_payment_preferences_order_idx
  on public.commerce_payment_preferences(order_id, created_at desc);

drop trigger if exists commerce_payment_preferences_updated_at on public.commerce_payment_preferences;
create trigger commerce_payment_preferences_updated_at
  before update on public.commerce_payment_preferences
  for each row execute function public.set_updated_at();

create or replace function public.claim_mercadopago_preference(p_external_user_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_order public.commerce_orders%rowtype;
  v_preference public.commerce_payment_preferences%rowtype;
  v_claim_token uuid := gen_random_uuid();
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
  if exists (select 1 from public.commerce_order_items oi where oi.order_id = v_order.id and (oi.quantity < 1 or oi.unit_price < 0))
    then raise exception 'Order item is invalid'; end if;
  if v_item_sum <> v_order.subtotal then raise exception 'Order item subtotal mismatch'; end if;
  if v_order.subtotal <> v_order.total then raise exception 'Order total mismatch'; end if;

  insert into public.commerce_payment_preferences(order_id, claim_token, claimed_at)
  values(v_order.id, v_claim_token, now())
  on conflict(provider, order_id) do nothing
  returning * into v_preference;

  if v_preference.id is not null then
    v_owned := true;
  else
    select * into v_preference from public.commerce_payment_preferences
    where provider = 'mercadopago' and order_id = v_order.id for update;

    if v_preference.status = 'failed'
      or (v_preference.status = 'creating' and v_preference.claimed_at < now() - interval '2 minutes') then
      update public.commerce_payment_preferences
      set status = 'creating', claim_token = v_claim_token, claimed_at = now(), last_error_code = null
      where id = v_preference.id returning * into v_preference;
      v_owned := true;
    end if;
  end if;

  return jsonb_build_object(
    'status', case when v_preference.status = 'ready' then 'payment_link_ready'
      when v_owned then 'payment_link_claimed' else 'payment_link_processing' end,
    'claimOwned', v_owned,
    'claimId', v_preference.id,
    'claimToken', case when v_owned then v_preference.claim_token else null end,
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'orderStatus', v_order.status,
    'currency', v_order.currency,
    'subtotal', v_order.subtotal,
    'total', v_order.total,
    'items', v_items,
    'preferenceId', v_preference.provider_preference_id,
    'paymentUrl', v_preference.init_point,
    'sandboxPaymentUrl', v_preference.sandbox_init_point
  );
end;
$$;

create or replace function public.complete_mercadopago_preference(
  p_claim_id uuid, p_claim_token uuid, p_preference_id text,
  p_init_point text, p_sandbox_init_point text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_row public.commerce_payment_preferences%rowtype;
begin
  if p_preference_id is null or length(trim(p_preference_id)) = 0
    or p_init_point is null or length(trim(p_init_point)) = 0 then
    raise exception 'Invalid Mercado Pago preference response';
  end if;
  update public.commerce_payment_preferences
  set status = 'ready', provider_preference_id = p_preference_id,
      init_point = p_init_point, sandbox_init_point = p_sandbox_init_point, last_error_code = null
  where id = p_claim_id and claim_token = p_claim_token and status = 'creating'
  returning * into v_row;
  if v_row.id is null then raise exception 'Mercado Pago preference claim lost'; end if;
  return jsonb_build_object('status', 'payment_link_ready', 'preferenceId', v_row.provider_preference_id,
    'paymentUrl', v_row.init_point, 'sandboxPaymentUrl', v_row.sandbox_init_point);
end;
$$;

create or replace function public.fail_mercadopago_preference(
  p_claim_id uuid, p_claim_token uuid, p_error_code text
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.commerce_payment_preferences
  set status = 'failed', last_error_code = left(coalesce(p_error_code, 'unknown'), 100)
  where id = p_claim_id and claim_token = p_claim_token and status = 'creating';
end;
$$;

alter table public.commerce_payment_preferences enable row level security;
revoke all on table public.commerce_payment_preferences from public, anon, authenticated;
grant select, insert, update on table public.commerce_payment_preferences to service_role;

revoke all on function public.claim_mercadopago_preference(text),
  public.complete_mercadopago_preference(uuid,uuid,text,text,text),
  public.fail_mercadopago_preference(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_mercadopago_preference(text),
  public.complete_mercadopago_preference(uuid,uuid,text,text,text),
  public.fail_mercadopago_preference(uuid,uuid,text) to service_role;
