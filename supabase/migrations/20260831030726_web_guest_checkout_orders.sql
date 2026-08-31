begin;

create sequence public.web_order_number_seq as bigint start with 1 increment by 1 no cycle;

create table public.web_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique check (order_number ~ '^COL-[0-9]{8}-[0-9]{6,}$'),
  source_cart_id uuid not null unique references public.web_carts(id) on delete restrict,
  session_id uuid not null references public.web_sessions(id) on delete restrict,
  idempotency_key uuid not null,
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','payment_failed','payment_review','cancelled','expired','refunded')),
  fulfillment_status text not null default 'unfulfilled' check (fulfillment_status in ('unfulfilled','preparing','ready_for_pickup','shipped','delivered','returned')),
  currency text not null default 'CLP' check (currency = 'CLP'),
  items_subtotal numeric(12,0) not null check (items_subtotal >= 0),
  discount_total numeric(12,0) not null default 0 check (discount_total >= 0 and discount_total <= items_subtotal),
  shipping_total numeric(12,0) not null default 0 check (shipping_total >= 0),
  total numeric(12,0) not null check (total = items_subtotal - discount_total + shipping_total),
  promotion_snapshot jsonb,
  shipping_snapshot jsonb not null,
  reservation_expires_at timestamptz not null,
  paid_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);

create table public.web_order_customers (
  order_id uuid primary key references public.web_orders(id) on delete restrict,
  email text not null check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  first_name text not null check (char_length(trim(first_name)) between 1 and 80),
  last_name text not null check (char_length(trim(last_name)) between 1 and 80),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.web_order_addresses (
  order_id uuid primary key references public.web_orders(id) on delete restrict,
  delivery_type text not null check (delivery_type in ('shipping','pickup')),
  recipient_name text not null check (char_length(trim(recipient_name)) between 1 and 161),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  street text,
  street_number text,
  complement text,
  region_code text,
  region_name text,
  commune text,
  postal_code text,
  delivery_instructions text,
  created_at timestamptz not null default now(),
  check (
    (delivery_type = 'pickup' and street is null and street_number is null and region_code is null and region_name is null and commune is null)
    or (delivery_type = 'shipping' and nullif(trim(street),'') is not null and nullif(trim(street_number),'') is not null
      and nullif(trim(region_code),'') is not null and nullif(trim(region_name),'') is not null and nullif(trim(commune),'') is not null)
  )
);

create table public.web_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name text not null,
  product_slug text not null,
  product_sku text,
  variant_sku text,
  brand text not null,
  category text not null,
  color text not null,
  size text not null,
  image_url text,
  quantity integer not null check (quantity > 0),
  list_unit_price numeric(12,0) not null check (list_unit_price >= 0),
  unit_discount numeric(12,2) not null default 0 check (unit_discount >= 0 and unit_discount <= list_unit_price),
  final_unit_price numeric(12,2) not null check (final_unit_price = list_unit_price - unit_discount),
  line_subtotal numeric(12,0) not null check (line_subtotal = round(final_unit_price * quantity)),
  promotion_snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (order_id, variant_id)
);

create table public.web_order_discounts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete restrict,
  promotion_id uuid references public.web_promotions(id) on delete set null,
  discount_code_id uuid references public.web_discount_codes(id) on delete set null,
  name text not null,
  discount_type text not null check (discount_type = 'percentage'),
  discount_percentage numeric(5,2) not null check (discount_percentage > 0 and discount_percentage <= 100),
  code text,
  amount numeric(12,0) not null check (amount > 0),
  eligibility_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (order_id, promotion_id)
);

alter table public.web_stock_reservations add column order_id uuid unique references public.web_orders(id) on delete restrict;
create index web_orders_status_expiry_idx on public.web_orders(status, reservation_expires_at);
create index web_order_items_order_idx on public.web_order_items(order_id, id);

create trigger web_orders_updated_at before update on public.web_orders for each row execute function public.set_updated_at();
create trigger web_order_customers_updated_at before update on public.web_order_customers for each row execute function public.set_updated_at();

alter table public.web_orders enable row level security;
alter table public.web_order_customers enable row level security;
alter table public.web_order_addresses enable row level security;
alter table public.web_order_items enable row level security;
alter table public.web_order_discounts enable row level security;
revoke all on table public.web_orders, public.web_order_customers, public.web_order_addresses, public.web_order_items, public.web_order_discounts from public, anon, authenticated;
grant select, insert, update, delete on table public.web_orders, public.web_order_customers, public.web_order_addresses, public.web_order_items, public.web_order_discounts to service_role;
revoke all on sequence public.web_order_number_seq from public, anon, authenticated;
grant usage, select on sequence public.web_order_number_seq to service_role;

create or replace function public.create_web_checkout(
  p_token_hash text,
  p_idempotency_key uuid,
  p_customer jsonb,
  p_delivery jsonb,
  p_discount_code text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  checkout_session public.web_sessions%rowtype;
  checkout_cart public.web_carts%rowtype;
  existing_order public.web_orders%rowtype;
  created_order public.web_orders%rowtype;
  created_reservation public.web_stock_reservations%rowtype;
  pricing jsonb;
  shipping jsonb;
  customer_email text := lower(trim(coalesce(p_customer->>'email','')));
  customer_first_name text := trim(coalesce(p_customer->>'firstName',''));
  customer_last_name text := trim(coalesce(p_customer->>'lastName',''));
  customer_phone text := regexp_replace(trim(coalesce(p_customer->>'phone','')), '[^+0-9]', '', 'g');
  delivery_type text := p_delivery->>'deliveryType';
  region_code text := nullif(trim(p_delivery->>'regionCode'),'');
  commune_name text := nullif(trim(p_delivery->>'commune'),'');
  reservation_until timestamptz := now() + interval '20 minutes';
  variant_ids uuid[];
  line record;
  promotion_id uuid;
  discount_code_id uuid;
  promotion_percentage numeric(5,2);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_idempotency_key is null then raise exception 'Invalid checkout identity'; end if;
  if customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid customer email'; end if;
  if char_length(customer_first_name) not between 1 and 80 or char_length(customer_last_name) not between 1 and 80 then raise exception 'Invalid customer name'; end if;
  if customer_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Invalid customer phone'; end if;
  if delivery_type not in ('pickup','shipping') then raise exception 'Invalid delivery type'; end if;
  if delivery_type = 'shipping' and (region_code is null or commune_name is null or nullif(trim(p_delivery->>'street'),'') is null or nullif(trim(p_delivery->>'number'),'') is null) then raise exception 'Incomplete shipping address'; end if;

  select * into checkout_session from public.web_sessions where token_hash = p_token_hash and status = 'active' and expires_at > now() for update;
  if not found then raise exception 'Cart session not found'; end if;
  select * into existing_order from public.web_orders where session_id = checkout_session.id and idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('orderId',existing_order.id,'orderNumber',existing_order.order_number,'status',existing_order.status,'total',existing_order.total,'reservationExpiresAt',existing_order.reservation_expires_at); end if;

  select * into checkout_cart from public.web_carts where session_id = checkout_session.id and status in ('open','checkout') and expires_at > now() order by created_at desc limit 1 for update;
  if not found then raise exception 'Open cart not found'; end if;
  select * into existing_order from public.web_orders where source_cart_id = checkout_cart.id;
  if found then return jsonb_build_object('orderId',existing_order.id,'orderNumber',existing_order.order_number,'status',existing_order.status,'total',existing_order.total,'reservationExpiresAt',existing_order.reservation_expires_at); end if;
  if checkout_cart.status <> 'open' then raise exception 'Cart is already in checkout'; end if;

  select array_agg(item.variant_id order by item.variant_id) into variant_ids from public.web_cart_items item where item.cart_id = checkout_cart.id;
  if coalesce(cardinality(variant_ids),0) = 0 then raise exception 'Cart is empty'; end if;
  perform * from public.lock_web_stock_variants(variant_ids);
  for line in select item.variant_id, item.quantity from public.web_cart_items item where item.cart_id = checkout_cart.id order by item.variant_id loop
    if public.web_variant_available_stock(line.variant_id) < line.quantity then raise exception 'Insufficient available stock'; end if;
  end loop;

  if p_discount_code is not null then perform public.set_web_cart_discount_code(p_token_hash, p_discount_code); end if;
  pricing := public.web_cart_snapshot(p_token_hash);
  if jsonb_array_length(coalesce(pricing->'items','[]'::jsonb)) = 0 then raise exception 'Cart is empty'; end if;
  if exists(select 1 from jsonb_array_elements(pricing->'items') item where not coalesce((item->>'available')::boolean,false)) then raise exception 'Cart contains unavailable items'; end if;
  shipping := public.resolve_web_shipping(case when delivery_type='pickup' then 'pickup' else 'shipping' end, region_code, commune_name);

  insert into public.web_orders(order_number,source_cart_id,session_id,idempotency_key,items_subtotal,discount_total,shipping_total,total,promotion_snapshot,shipping_snapshot,reservation_expires_at)
  values ('COL-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.web_order_number_seq')::text,6,'0'),checkout_cart.id,checkout_session.id,p_idempotency_key,
    (pricing->>'listSubtotal')::numeric,(pricing->>'discountAmount')::numeric,(shipping->>'amount')::numeric,
    (pricing->>'productsTotal')::numeric+(shipping->>'amount')::numeric,pricing->'promotion',shipping,reservation_until)
  returning * into created_order;

  insert into public.web_order_customers(order_id,email,first_name,last_name,phone) values (created_order.id,customer_email,customer_first_name,customer_last_name,customer_phone);
  insert into public.web_order_addresses(order_id,delivery_type,recipient_name,phone,street,street_number,complement,region_code,region_name,commune,postal_code,delivery_instructions)
  values (created_order.id,delivery_type,customer_first_name||' '||customer_last_name,customer_phone,
    case when delivery_type='shipping' then trim(p_delivery->>'street') end,case when delivery_type='shipping' then trim(p_delivery->>'number') end,
    nullif(trim(p_delivery->>'complement'),''),case when delivery_type='shipping' then region_code end,
    case when delivery_type='shipping' then (select name from public.web_shipping_regions where code=region_code) end,
    case when delivery_type='shipping' then commune_name end,nullif(trim(p_delivery->>'postalCode'),''),nullif(trim(p_delivery->>'instructions'),''));

  insert into public.web_order_items(order_id,product_id,variant_id,product_name,product_slug,product_sku,variant_sku,brand,category,color,size,image_url,quantity,list_unit_price,unit_discount,final_unit_price,line_subtotal,promotion_snapshot)
  select created_order.id,product.id,variant.id,product.name,product.slug,product.sku,variant.sku,brand.name,category.name,variant.color,variant.size,
    image.image_url,item.quantity,product.price,
    coalesce(((priced.value->>'discountAmount')::numeric/item.quantity),0),
    product.price-coalesce(((priced.value->>'discountAmount')::numeric/item.quantity),0),
    (priced.value->>'total')::numeric,case when (priced.value->>'discountAmount')::numeric>0 then pricing->'promotion' end
  from public.web_cart_items item join public.products product on product.id=item.product_id
  join public.product_variants variant on variant.id=item.variant_id join public.brands brand on brand.id=product.brand_id
  join public.categories category on category.id=product.category_id
  join lateral jsonb_array_elements(pricing->'items') priced(value) on (priced.value->>'itemId')::uuid=item.id
  left join lateral (select product_image.image_url from public.product_images product_image where product_image.product_id=product.id and product_image.status='ready' order by product_image.position,product_image.id limit 1) image on true;

  if (pricing->>'discountAmount')::numeric > 0 and pricing->'promotion' is not null then
    promotion_id := (pricing->'promotion'->>'id')::uuid;
    select discount_percentage into promotion_percentage from public.web_promotions where id=promotion_id;
    if pricing->'promotion'->>'code' is not null then select id into discount_code_id from public.web_discount_codes where code=pricing->'promotion'->>'code'; end if;
    insert into public.web_order_discounts(order_id,promotion_id,discount_code_id,name,discount_type,discount_percentage,code,amount,eligibility_snapshot)
    values(created_order.id,promotion_id,discount_code_id,pricing->'promotion'->>'name','percentage',promotion_percentage,pricing->'promotion'->>'code',(pricing->>'discountAmount')::numeric,
      jsonb_build_object('listSubtotal',pricing->>'listSubtotal','winnerRule','highest_discount_priority_created_uuid'));
  end if;

  insert into public.web_stock_reservations(cart_id,order_id,status,expires_at) values(checkout_cart.id,created_order.id,'active',reservation_until) returning * into created_reservation;
  insert into public.web_stock_reservation_items(reservation_id,variant_id,quantity)
  select created_reservation.id,item.variant_id,item.quantity from public.web_cart_items item where item.cart_id=checkout_cart.id order by item.variant_id;
  update public.web_carts set status='checkout' where id=checkout_cart.id;

  return jsonb_build_object('orderId',created_order.id,'orderNumber',created_order.order_number,'status',created_order.status,'total',created_order.total,'reservationExpiresAt',created_order.reservation_expires_at);
end;
$$;
alter function public.create_web_checkout(text,uuid,jsonb,jsonb,text) owner to postgres;
revoke all on function public.create_web_checkout(text,uuid,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_web_checkout(text,uuid,jsonb,jsonb,text) to service_role;

comment on function public.create_web_checkout(text,uuid,jsonb,jsonb,text) is '4D: pedido guest, snapshots y reserva atómicos por 20 minutos. No crea pago ni consume stock físico.';

commit;
