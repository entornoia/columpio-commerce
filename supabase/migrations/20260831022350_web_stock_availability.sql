begin;

create table public.web_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.web_carts(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'consumed', 'released', 'expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (
    (status = 'active' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status in ('released', 'expired') and consumed_at is null and released_at is not null)
  ),
  check (status not in ('released', 'expired') or nullif(trim(release_reason), '') is not null)
);

create table public.web_stock_reservation_items (
  reservation_id uuid not null references public.web_stock_reservations(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (reservation_id, variant_id)
);

create index web_stock_reservations_active_expiry_idx
  on public.web_stock_reservations(expires_at) where status = 'active';
create index web_stock_reservation_items_variant_idx
  on public.web_stock_reservation_items(variant_id, reservation_id);

create trigger web_stock_reservations_updated_at before update on public.web_stock_reservations
for each row execute function public.set_updated_at();

alter table public.web_stock_reservations enable row level security;
alter table public.web_stock_reservation_items enable row level security;
revoke all on table public.web_stock_reservations, public.web_stock_reservation_items from public, anon, authenticated;
grant select, insert, update, delete on table public.web_stock_reservations, public.web_stock_reservation_items to service_role;

create or replace function public.web_variant_available_stock(p_variant_id uuid)
returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(
    variant.stock - coalesce((
      select sum(item.quantity)::integer
      from public.web_stock_reservation_items item
      join public.web_stock_reservations reservation on reservation.id = item.reservation_id
      where item.variant_id = variant.id
        and reservation.status = 'active'
        and reservation.expires_at > now()
    ), 0),
    0
  )::integer
  from public.product_variants variant
  where variant.id = p_variant_id;
$$;
alter function public.web_variant_available_stock(uuid) owner to postgres;
revoke all on function public.web_variant_available_stock(uuid) from public, anon, authenticated;
grant execute on function public.web_variant_available_stock(uuid) to service_role;

-- 4D reutilizará este lock antes de insertar una reserva. Bloquea todas las
-- variantes en orden UUID determinista, calcula disponibilidad dentro de la
-- misma transacción y falla completa si falta o se duplica un identificador.
create or replace function public.lock_web_stock_variants(p_variant_ids uuid[])
returns table (variant_id uuid, available_stock integer)
language plpgsql volatile security definer set search_path = '' as $$
declare
  requested_count integer;
  locked_count integer;
begin
  requested_count := coalesce(cardinality(p_variant_ids), 0);
  if requested_count = 0 then raise exception 'At least one variant is required'; end if;
  if requested_count <> (select count(distinct requested.value) from unnest(p_variant_ids) as requested(value)) then
    raise exception 'Duplicate variant IDs are not allowed';
  end if;

  return query
    with locked as (
      select variant.id
      from public.product_variants variant
      where variant.id = any(p_variant_ids)
      order by variant.id
      for update
    )
    select locked.id, public.web_variant_available_stock(locked.id)
    from locked
    order by locked.id;
  get diagnostics locked_count = row_count;
  if locked_count <> requested_count then raise exception 'Product variant not found'; end if;
end;
$$;
alter function public.lock_web_stock_variants(uuid[]) owner to postgres;
revoke all on function public.lock_web_stock_variants(uuid[]) from public, anon, authenticated;
grant execute on function public.lock_web_stock_variants(uuid[]) to service_role;

create or replace function public.get_catalog_variant_availability(p_variant_ids uuid[] default null)
returns table (variant_id uuid, available_stock integer)
language sql stable security definer set search_path = '' as $$
  select variant.id, public.web_variant_available_stock(variant.id)
  from public.product_variants variant
  where p_variant_ids is null or variant.id = any(p_variant_ids)
  order by variant.id;
$$;
alter function public.get_catalog_variant_availability(uuid[]) owner to postgres;
revoke all on function public.get_catalog_variant_availability(uuid[]) from public, anon, authenticated;
grant execute on function public.get_catalog_variant_availability(uuid[]) to authenticated, service_role;

create or replace function public.list_public_products(p_category_slug text default null, p_limit integer default 24)
returns table (
  id uuid, brand_slug text, category_slug text, category_name text, slug text,
  name text, short_description text, description text, price numeric, style text,
  material text, is_available boolean, colors jsonb, sizes jsonb, images jsonb, published_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select product.id, brand.slug, category.slug, category.name, product.slug,
    product.name, product.short_description, product.description, product.price, product.style, product.material,
    exists (select 1 from public.product_variants available_variant where available_variant.product_id = product.id and available_variant.active and public.web_variant_available_stock(available_variant.id) > 0),
    coalesce((select jsonb_agg(distinct variant.color) from public.product_variants variant where variant.product_id = product.id and variant.active and public.web_variant_available_stock(variant.id) > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(distinct variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active and public.web_variant_available_stock(variant.id) > 0), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id and image.status = 'ready'), '[]'::jsonb),
    product.published_at
  from public.products product join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active and product.publication_status = 'published'
    and (p_category_slug is null or category.slug = public.catalog_slugify(p_category_slug))
  order by product.published_at desc, product.name limit greatest(0, least(coalesce(p_limit, 24), 100));
$$;
alter function public.list_public_products(text, integer) owner to postgres;
revoke all on function public.list_public_products(text, integer) from public, anon, authenticated;
grant execute on function public.list_public_products(text, integer) to anon, authenticated;

create or replace function public.get_public_product_by_slug(p_slug text, p_brand_slug text default 'mujer')
returns table (
  id uuid, brand_slug text, brand_name text, category_slug text, category_name text,
  slug text, name text, short_description text, description text, price numeric, style text,
  material text, is_available boolean, variants jsonb, images jsonb, seo_title text,
  seo_description text, published_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select product.id, brand.slug, brand.name, category.slug, category.name, product.slug,
    product.name, product.short_description, product.description, product.price, product.style, product.material,
    exists (select 1 from public.product_variants available_variant where available_variant.product_id = product.id and available_variant.active and public.web_variant_available_stock(available_variant.id) > 0),
    coalesce((select jsonb_agg(jsonb_build_object('id', variant.id, 'color', variant.color, 'size', variant.size, 'available', (public.web_variant_available_stock(variant.id) > 0)) order by variant.color, variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id and image.status = 'ready'), '[]'::jsonb),
    product.seo_title, product.seo_description, product.published_at
  from public.products product join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active and product.publication_status = 'published'
    and product.slug = public.catalog_slugify(p_slug) and brand.slug = public.catalog_slugify(p_brand_slug)
  limit 1;
$$;
alter function public.get_public_product_by_slug(text, text) owner to postgres;
revoke all on function public.get_public_product_by_slug(text, text) from public, anon, authenticated;
grant execute on function public.get_public_product_by_slug(text, text) to anon, authenticated;

create or replace function public.web_cart_snapshot(p_token_hash text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with selected_session as (
    select session.id from public.web_sessions session
    where session.token_hash = p_token_hash and session.status = 'active' and session.expires_at > now()
  ), selected_cart as (
    select cart.id, cart.currency from public.web_carts cart join selected_session session on session.id = cart.session_id
    where cart.status = 'open' and cart.expires_at > now() limit 1
  ), current_items as (
    select item.id as item_id, product.id as product_id, variant.id as variant_id,
      product.name, product.slug, brand.slug as brand_slug, variant.color, variant.size,
      product.price as unit_price, item.quantity, product.price * item.quantity as subtotal,
      (product.active and product.publication_status = 'published' and brand.active and category.active
        and variant.active and public.web_variant_available_stock(variant.id) >= item.quantity) as available,
      image.image_url
    from selected_cart cart join public.web_cart_items item on item.cart_id = cart.id
    join public.products product on product.id = item.product_id
    join public.product_variants variant on variant.id = item.variant_id and variant.product_id = product.id
    join public.brands brand on brand.id = product.brand_id
    join public.categories category on category.id = product.category_id and category.brand_id = brand.id
    left join lateral (select product_image.image_url from public.product_images product_image where product_image.product_id = product.id and product_image.status = 'ready' order by product_image.position, product_image.id limit 1) image on true
  )
  select jsonb_build_object(
    'cartId', (select id from selected_cart), 'currency', coalesce((select currency from selected_cart), 'CLP'),
    'count', coalesce((select sum(quantity) from current_items), 0),
    'estimatedTotal', coalesce((select sum(subtotal) from current_items), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'itemId', item_id, 'productId', product_id, 'variantId', variant_id, 'name', name, 'slug', slug,
      'brandSlug', brand_slug, 'color', color, 'size', size, 'imageUrl', image_url,
      'unitPrice', unit_price, 'quantity', quantity, 'subtotal', subtotal, 'available', available
    ) order by item_id) from current_items), '[]'::jsonb)
  );
$$;
alter function public.web_cart_snapshot(text) owner to postgres;
revoke all on function public.web_cart_snapshot(text) from public, anon, authenticated;
grant execute on function public.web_cart_snapshot(text) to service_role;

create or replace function public.mutate_web_cart(
  p_token_hash text, p_operation text, p_variant_id uuid default null, p_item_id uuid default null,
  p_quantity integer default null, p_create_session boolean default false
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  selected_session public.web_sessions%rowtype;
  selected_cart public.web_carts%rowtype;
  selected_variant record;
  selected_item public.web_cart_items%rowtype;
  target_quantity integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid cart session'; end if;
  if p_operation not in ('add', 'set_quantity', 'remove', 'clear') then raise exception 'Invalid cart operation'; end if;
  select * into selected_session from public.web_sessions where token_hash = p_token_hash and status = 'active' and expires_at > now() for update;
  if not found then
    if not (p_create_session and p_operation = 'add') then return public.web_cart_snapshot(p_token_hash); end if;
    insert into public.web_sessions(token_hash) values (p_token_hash) returning * into selected_session;
  else
    update public.web_sessions set last_seen_at = now() where id = selected_session.id;
  end if;
  select * into selected_cart from public.web_carts where session_id = selected_session.id and status = 'open' and expires_at > now() for update;
  if not found and p_operation = 'add' then
    insert into public.web_carts(session_id, expires_at) values (selected_session.id, least(selected_session.expires_at, now() + interval '30 days')) returning * into selected_cart;
  elsif not found then return public.web_cart_snapshot(p_token_hash); end if;

  if p_operation = 'add' then
    if p_variant_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Invalid item'; end if;
    select variant.id, variant.product_id, public.web_variant_available_stock(variant.id) as available_stock into selected_variant
    from public.product_variants variant join public.products product on product.id = variant.product_id
    join public.brands brand on brand.id = product.brand_id and brand.active
    join public.categories category on category.id = product.category_id and category.active and category.brand_id = brand.id
    where variant.id = p_variant_id and variant.active and product.active and product.publication_status = 'published' for update of variant;
    if not found then raise exception 'Product variant is not available'; end if;
    select * into selected_item from public.web_cart_items where cart_id = selected_cart.id and variant_id = p_variant_id for update;
    target_quantity := coalesce(selected_item.quantity, 0) + p_quantity;
    if target_quantity > selected_variant.available_stock then raise exception 'Insufficient available stock'; end if;
    insert into public.web_cart_items(cart_id, product_id, variant_id, quantity)
    values (selected_cart.id, selected_variant.product_id, p_variant_id, p_quantity)
    on conflict (cart_id, variant_id) do update set quantity = excluded.quantity + public.web_cart_items.quantity;
  elsif p_operation = 'set_quantity' then
    if p_item_id is null or p_quantity is null or p_quantity <= 0 then raise exception 'Invalid item'; end if;
    select item.* into selected_item from public.web_cart_items item where item.id = p_item_id and item.cart_id = selected_cart.id for update;
    if not found then raise exception 'Cart item not found'; end if;
    select variant.id, public.web_variant_available_stock(variant.id) as available_stock into selected_variant
    from public.product_variants variant join public.products product on product.id = variant.product_id
    where variant.id = selected_item.variant_id and variant.active and product.active and product.publication_status = 'published' for update of variant;
    if not found or p_quantity > selected_variant.available_stock then raise exception 'Insufficient available stock'; end if;
    update public.web_cart_items set quantity = p_quantity where id = selected_item.id;
  elsif p_operation = 'remove' then
    if p_item_id is null then raise exception 'Invalid item'; end if;
    delete from public.web_cart_items where id = p_item_id and cart_id = selected_cart.id;
  else
    delete from public.web_cart_items where cart_id = selected_cart.id;
  end if;
  return public.web_cart_snapshot(p_token_hash);
end;
$$;
alter function public.mutate_web_cart(text, text, uuid, uuid, integer, boolean) owner to postgres;
revoke all on function public.mutate_web_cart(text, text, uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.mutate_web_cart(text, text, uuid, uuid, integer, boolean) to service_role;

comment on table public.web_stock_reservations is 'Reservas web previas al pedido. En 4B solo sustentan disponibilidad; 4D añadirá creación desde checkout y relación con web_orders.';
comment on function public.lock_web_stock_variants(uuid[]) is 'Primitiva privada para que 4D bloquee variantes en orden determinista antes de comprobar e insertar toda una reserva.';

commit;
