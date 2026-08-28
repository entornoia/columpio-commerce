-- BLOQUE 4A/4B: carrito conversacional y pedidos persistentes de Instagram.
create sequence if not exists public.commerce_order_number_seq start with 100001;

create table if not exists public.commerce_carts (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.instagram_conversations(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'converted', 'abandoned')),
  currency text not null default 'CLP' check (currency = 'CLP'),
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists commerce_carts_one_open_idx on public.commerce_carts(conversation_id) where status = 'open';
create index if not exists commerce_carts_conversation_idx on public.commerce_carts(conversation_id, created_at desc);

create table if not exists public.commerce_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.commerce_carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity between 1 and 20),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);
create index if not exists commerce_cart_items_cart_idx on public.commerce_cart_items(cart_id);

create table if not exists public.commerce_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null default ('COL-' || nextval('public.commerce_order_number_seq')::text) unique,
  conversation_id uuid not null references public.instagram_conversations(id) on delete restrict,
  source_cart_id uuid not null references public.commerce_carts(id) on delete restrict unique,
  source_event_id text not null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'cancelled')),
  currency text not null default 'CLP' check (currency = 'CLP'),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  total numeric(14,2) not null check (total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (conversation_id, source_event_id)
);
create index if not exists commerce_orders_conversation_idx on public.commerce_orders(conversation_id, created_at desc);

create table if not exists public.commerce_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.commerce_orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name text not null,
  product_sku text not null,
  variant_sku text not null,
  color text not null,
  size text not null,
  quantity integer not null check (quantity between 1 and 20),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  subtotal numeric(14,2) generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now(),
  unique (order_id, variant_id)
);
create index if not exists commerce_order_items_order_idx on public.commerce_order_items(order_id);

create table if not exists public.commerce_operations (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel = 'instagram'),
  external_event_id text not null,
  operation_key text not null,
  operation_type text not null check (operation_type in ('add_to_cart', 'remove_from_cart', 'set_cart_quantity', 'create_order')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (channel, external_event_id, operation_key)
);

drop trigger if exists commerce_carts_updated_at on public.commerce_carts;
create trigger commerce_carts_updated_at before update on public.commerce_carts for each row execute function public.set_updated_at();
drop trigger if exists commerce_cart_items_updated_at on public.commerce_cart_items;
create trigger commerce_cart_items_updated_at before update on public.commerce_cart_items for each row execute function public.set_updated_at();
drop trigger if exists commerce_orders_updated_at on public.commerce_orders;
create trigger commerce_orders_updated_at before update on public.commerce_orders for each row execute function public.set_updated_at();

create or replace function public.commerce_cart_snapshot(p_cart_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'status', 'cart', 'cartId', c.id, 'cartStatus', c.status, 'currency', c.currency,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'productId', p.id, 'variantId', v.id, 'productName', p.name, 'productSku', p.sku,
      'variantSku', v.variant_sku, 'color', v.color, 'size', v.size, 'quantity', i.quantity,
      'unitPrice', i.unit_price, 'subtotal', i.subtotal, 'currentStock', v.stock
    ) order by i.created_at) from public.commerce_cart_items i
      join public.products p on p.id = i.product_id join public.product_variants v on v.id = i.variant_id
      where i.cart_id = c.id), '[]'::jsonb),
    'subtotal', coalesce((select sum(i.subtotal) from public.commerce_cart_items i where i.cart_id = c.id), 0)
  ) from public.commerce_carts c where c.id = p_cart_id;
$$;

create or replace function public.get_instagram_cart(p_external_user_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_cart_id uuid;
begin
  select c.id into v_cart_id from public.commerce_carts c
  join public.instagram_conversations ic on ic.id = c.conversation_id
  where ic.channel = 'instagram' and ic.external_user_id = p_external_user_id and c.status = 'open'
  order by c.created_at desc limit 1;
  if v_cart_id is null then return jsonb_build_object('status', 'empty', 'items', '[]'::jsonb, 'subtotal', 0, 'currency', 'CLP'); end if;
  return public.commerce_cart_snapshot(v_cart_id);
end;
$$;

create or replace function public.mutate_instagram_cart(
  p_external_user_id text, p_event_id text, p_operation_key text,
  p_operation_type text, p_variant_id uuid, p_quantity integer default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_conversation_id uuid; v_cart_id uuid; v_product_id uuid; v_price numeric(12,2);
  v_stock integer; v_active boolean; v_product_active boolean; v_existing integer := 0;
  v_target integer; v_result jsonb;
begin
  if p_operation_type not in ('add_to_cart', 'remove_from_cart', 'set_cart_quantity') then raise exception 'Invalid commerce operation'; end if;
  if p_event_id is null or length(trim(p_event_id)) = 0 or p_operation_key is null or length(trim(p_operation_key)) = 0 then raise exception 'Missing idempotency data'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':', 'instagram', p_event_id, p_operation_key), 0));
  select result into v_result from public.commerce_operations where channel='instagram' and external_event_id=p_event_id and operation_key=p_operation_key;
  if v_result is not null then return v_result; end if;

  select id into v_conversation_id from public.instagram_conversations
  where channel='instagram' and external_user_id=p_external_user_id for update;
  if v_conversation_id is null then raise exception 'Instagram conversation not found'; end if;

  select c.id into v_cart_id from public.commerce_carts c where c.conversation_id=v_conversation_id and c.status='open' for update;
  if p_operation_type in ('add_to_cart', 'set_cart_quantity') then
    if p_quantity is null or p_quantity < 1 or p_quantity > 20 then raise exception 'Quantity must be between 1 and 20'; end if;
    select v.product_id, p.price, v.stock, v.active, p.active into v_product_id, v_price, v_stock, v_active, v_product_active
    from public.product_variants v join public.products p on p.id=v.product_id where v.id=p_variant_id for update of v, p;
    if v_product_id is null or not v_active or not v_product_active then raise exception 'Product or variant is unavailable'; end if;
    if v_cart_id is null and p_operation_type='add_to_cart' then
      insert into public.commerce_carts(conversation_id) values(v_conversation_id) returning id into v_cart_id;
    end if;
    if v_cart_id is null then raise exception 'Open cart not found'; end if;
    select quantity into v_existing from public.commerce_cart_items where cart_id=v_cart_id and variant_id=p_variant_id for update;
    v_existing := coalesce(v_existing, 0);
    if p_operation_type='set_cart_quantity' and v_existing=0 then raise exception 'Cart item not found'; end if;
    v_target := case when p_operation_type='add_to_cart' then v_existing+p_quantity else p_quantity end;
    if v_target > 20 then raise exception 'Accumulated quantity exceeds 20'; end if;
    if v_target > v_stock then raise exception 'Insufficient stock'; end if;
    insert into public.commerce_cart_items(cart_id,product_id,variant_id,quantity,unit_price)
      values(v_cart_id,v_product_id,p_variant_id,v_target,v_price)
      on conflict(cart_id,variant_id) do update set quantity=excluded.quantity, unit_price=excluded.unit_price, updated_at=now();
  else
    if v_cart_id is not null then delete from public.commerce_cart_items where cart_id=v_cart_id and variant_id=p_variant_id; end if;
  end if;
  v_result := case when v_cart_id is null then jsonb_build_object('status','empty','items','[]'::jsonb,'subtotal',0,'currency','CLP') else public.commerce_cart_snapshot(v_cart_id) end;
  insert into public.commerce_operations(channel,external_event_id,operation_key,operation_type,result)
    values('instagram',p_event_id,p_operation_key,p_operation_type,v_result);
  return v_result;
end;
$$;

create or replace function public.create_instagram_order(p_external_user_id text, p_event_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_conversation_id uuid; v_cart_id uuid; v_order_id uuid; v_order_number text;
  v_subtotal numeric(14,2); v_result jsonb; v_price_changed boolean := false; item record;
begin
  if p_event_id is null or length(trim(p_event_id)) = 0 then raise exception 'Missing idempotency data'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','instagram',p_event_id,'create_order'),0));
  select result into v_result from public.commerce_operations where channel='instagram' and external_event_id=p_event_id and operation_key='create_order';
  if v_result is not null then return v_result; end if;
  select id into v_conversation_id from public.instagram_conversations where channel='instagram' and external_user_id=p_external_user_id for update;
  if v_conversation_id is null then raise exception 'Instagram conversation not found'; end if;
  select id into v_cart_id from public.commerce_carts where conversation_id=v_conversation_id and status='open' for update;
  if v_cart_id is null then raise exception 'Open cart not found'; end if;
  if not exists(select 1 from public.commerce_cart_items where cart_id=v_cart_id) then raise exception 'Cart is empty'; end if;

  for item in select i.id, i.quantity, i.unit_price, p.price current_price, p.active product_active, v.active variant_active, v.stock
    from public.commerce_cart_items i join public.products p on p.id=i.product_id
    join public.product_variants v on v.id=i.variant_id where i.cart_id=v_cart_id for update of i,p,v
  loop
    if not item.product_active or not item.variant_active then raise exception 'Product or variant is unavailable'; end if;
    if item.quantity > item.stock then raise exception 'Insufficient stock'; end if;
    if item.unit_price <> item.current_price then
      update public.commerce_cart_items set unit_price=item.current_price, updated_at=now() where id=item.id;
      v_price_changed := true;
    end if;
  end loop;
  if v_price_changed then
    v_result := public.commerce_cart_snapshot(v_cart_id) || jsonb_build_object('status','price_changed','requiresConfirmation',true);
    insert into public.commerce_operations(channel,external_event_id,operation_key,operation_type,result)
      values('instagram',p_event_id,'create_order','create_order',v_result);
    return v_result;
  end if;

  select sum(subtotal) into v_subtotal from public.commerce_cart_items where cart_id=v_cart_id;
  insert into public.commerce_orders(conversation_id,source_cart_id,source_event_id,subtotal,total)
    values(v_conversation_id,v_cart_id,p_event_id,v_subtotal,v_subtotal) returning id,order_number into v_order_id,v_order_number;
  insert into public.commerce_order_items(order_id,product_id,variant_id,product_name,product_sku,variant_sku,color,size,quantity,unit_price)
    select v_order_id,i.product_id,i.variant_id,p.name,p.sku,v.variant_sku,v.color,v.size,i.quantity,i.unit_price
    from public.commerce_cart_items i join public.products p on p.id=i.product_id join public.product_variants v on v.id=i.variant_id
    where i.cart_id=v_cart_id;
  update public.commerce_carts set status='converted',converted_at=now(),updated_at=now() where id=v_cart_id;
  v_result := jsonb_build_object('status','order_created','orderId',v_order_id,'orderNumber',v_order_number,'orderStatus','pending_payment','currency','CLP','subtotal',v_subtotal,'total',v_subtotal,
    'items',(select jsonb_agg(jsonb_build_object('productId',oi.product_id,'variantId',oi.variant_id,'productName',oi.product_name,'productSku',oi.product_sku,'variantSku',oi.variant_sku,'color',oi.color,'size',oi.size,'quantity',oi.quantity,'unitPrice',oi.unit_price,'subtotal',oi.subtotal)) from public.commerce_order_items oi where oi.order_id=v_order_id));
  insert into public.commerce_operations(channel,external_event_id,operation_key,operation_type,result)
    values('instagram',p_event_id,'create_order','create_order',v_result);
  return v_result;
end;
$$;

alter table public.commerce_carts enable row level security;
alter table public.commerce_cart_items enable row level security;
alter table public.commerce_orders enable row level security;
alter table public.commerce_order_items enable row level security;
alter table public.commerce_operations enable row level security;
revoke all on table public.commerce_carts, public.commerce_cart_items, public.commerce_orders, public.commerce_order_items, public.commerce_operations from public, anon, authenticated;
grant select,insert,update,delete on table public.commerce_carts, public.commerce_cart_items, public.commerce_orders, public.commerce_order_items, public.commerce_operations to service_role;
grant usage,select on sequence public.commerce_order_number_seq to service_role;
revoke all on function public.commerce_cart_snapshot(uuid), public.get_instagram_cart(text), public.mutate_instagram_cart(text,text,text,text,uuid,integer), public.create_instagram_order(text,text) from public, anon, authenticated;
grant execute on function public.commerce_cart_snapshot(uuid), public.get_instagram_cart(text), public.mutate_instagram_cart(text,text,text,text,uuid,integer), public.create_instagram_order(text,text) to service_role;
