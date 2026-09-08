begin;

create table public.web_order_admin_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete restrict,
  event_type text not null check (event_type = 'fulfillment_status_changed'),
  from_status text not null check (from_status in ('unfulfilled','preparing','ready_for_pickup','shipped','delivered','returned')),
  to_status text not null check (to_status in ('unfulfilled','preparing','ready_for_pickup','shipped','delivered','returned')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  note text check (note is null or char_length(note) between 1 and 500),
  created_at timestamptz not null default now(),
  check (from_status <> to_status)
);

create index web_order_admin_events_order_created_idx
  on public.web_order_admin_events(order_id, created_at desc);

alter table public.web_order_admin_events enable row level security;
revoke all on table public.web_order_admin_events from public, anon, authenticated;
grant select, insert on table public.web_order_admin_events to service_role;

create or replace function public.prevent_web_order_admin_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  raise exception 'Order administration events are immutable';
end;
$$;
alter function public.prevent_web_order_admin_event_mutation() owner to postgres;
revoke all on function public.prevent_web_order_admin_event_mutation() from public, anon, authenticated;

create trigger web_order_admin_events_immutable
before update or delete on public.web_order_admin_events
for each row execute function public.prevent_web_order_admin_event_mutation();

create or replace function public.transition_web_order_fulfillment(
  p_order_id uuid,
  p_expected_status text,
  p_to_status text,
  p_actor_user_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = '' as $$
declare
  actor_id uuid := p_actor_user_id;
  selected_order public.web_orders%rowtype;
  selected_payment public.web_payments%rowtype;
  delivery_type text;
  normalized_note text := nullif(trim(p_note), '');
  created_event public.web_order_admin_events%rowtype;
begin
  if actor_id is null or not exists(select 1 from auth.users users where users.id = actor_id) then
    raise exception 'Administrative actor not found';
  end if;
  if p_order_id is null or p_expected_status is null or p_to_status is null then
    raise exception 'Order and statuses are required';
  end if;
  if normalized_note is not null and char_length(normalized_note) > 500 then
    raise exception 'Note is too long';
  end if;

  select * into selected_order
  from public.web_orders orders
  where orders.id = p_order_id
  for update;
  if not found then raise exception 'Order not found'; end if;
  if selected_order.status <> 'paid' then raise exception 'Only paid orders can advance fulfillment'; end if;
  if selected_order.fulfillment_status <> p_expected_status then raise exception 'Fulfillment status changed'; end if;

  select * into selected_payment
  from public.web_payments payments
  where payments.order_id = selected_order.id;
  if not found or selected_payment.status <> 'paid' or selected_payment.stock_exception then
    raise exception 'Payment is not operationally confirmed';
  end if;

  select addresses.delivery_type into delivery_type
  from public.web_order_addresses addresses
  where addresses.order_id = selected_order.id;
  if delivery_type is null then raise exception 'Order delivery snapshot not found'; end if;

  if not (
    (p_expected_status = 'unfulfilled' and p_to_status = 'preparing')
    or (delivery_type = 'pickup' and p_expected_status = 'preparing' and p_to_status = 'ready_for_pickup')
    or (delivery_type = 'shipping' and p_expected_status = 'preparing' and p_to_status = 'shipped')
    or (delivery_type = 'shipping' and p_expected_status = 'shipped' and p_to_status = 'delivered')
  ) then
    raise exception 'Invalid fulfillment transition for delivery method';
  end if;

  update public.web_orders
  set fulfillment_status = p_to_status
  where id = selected_order.id and fulfillment_status = p_expected_status;
  if not found then raise exception 'Fulfillment status changed'; end if;

  insert into public.web_order_admin_events(order_id,event_type,from_status,to_status,actor_user_id,note)
  values(selected_order.id,'fulfillment_status_changed',p_expected_status,p_to_status,actor_id,normalized_note)
  returning * into created_event;

  return jsonb_build_object(
    'orderId', selected_order.id,
    'fulfillmentStatus', p_to_status,
    'eventId', created_event.id,
    'createdAt', created_event.created_at
  );
end;
$$;
alter function public.transition_web_order_fulfillment(uuid,text,text,uuid,text) owner to postgres;
revoke all on function public.transition_web_order_fulfillment(uuid,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.transition_web_order_fulfillment(uuid,text,text,uuid,text) to service_role;

comment on table public.web_order_admin_events is
  'Ledger inmutable de acciones administrativas sobre pedidos web. P2 no permite cambios manuales de pago, totales ni snapshots.';
comment on function public.transition_web_order_fulfillment(uuid,text,text,uuid,text) is
  'Transición fulfillment autenticada, serializada y auditada según modalidad persistida del pedido.';

commit;
