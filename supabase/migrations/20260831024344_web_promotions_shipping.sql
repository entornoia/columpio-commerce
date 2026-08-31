begin;

create table public.web_promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (nullif(trim(name), '') is not null),
  description text,
  discount_type text not null default 'percentage' check (discount_type = 'percentage'),
  discount_percentage numeric(5,2) not null check (discount_percentage > 0 and discount_percentage <= 100),
  minimum_subtotal numeric(12,0) not null default 0 check (minimum_subtotal >= 0),
  activation_type text not null check (activation_type in ('automatic', 'code')),
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 0,
  usage_limit_total integer check (usage_limit_total is null or usage_limit_total > 0),
  usage_limit_per_email integer check (usage_limit_per_email is null or usage_limit_per_email > 0),
  stackable boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'expired', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

create table public.web_promotion_targets (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.web_promotions(id) on delete cascade,
  target_type text not null check (target_type in ('product', 'category', 'color', 'brand')),
  product_id uuid references public.products(id) on delete restrict,
  category_id uuid references public.categories(id) on delete restrict,
  brand_id uuid references public.brands(id) on delete restrict,
  color text,
  created_at timestamptz not null default now(),
  check (
    (target_type = 'product' and product_id is not null and category_id is null and brand_id is null and color is null)
    or (target_type = 'category' and product_id is null and category_id is not null and brand_id is null and color is null)
    or (target_type = 'brand' and product_id is null and category_id is null and brand_id is not null and color is null)
    or (target_type = 'color' and product_id is null and category_id is null and brand_id is null and nullif(trim(color), '') is not null)
  )
);
create unique index web_promotion_targets_product_unique on public.web_promotion_targets(promotion_id, product_id) where target_type = 'product';
create unique index web_promotion_targets_category_unique on public.web_promotion_targets(promotion_id, category_id) where target_type = 'category';
create unique index web_promotion_targets_brand_unique on public.web_promotion_targets(promotion_id, brand_id) where target_type = 'brand';
create unique index web_promotion_targets_color_unique on public.web_promotion_targets(promotion_id, lower(trim(color))) where target_type = 'color';

create table public.web_discount_codes (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.web_promotions(id) on delete restrict,
  code text not null check (code = upper(trim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{2,39}$'),
  starts_at timestamptz,
  ends_at timestamptz,
  usage_limit_total integer check (usage_limit_total is null or usage_limit_total > 0),
  usage_limit_per_email integer check (usage_limit_per_email is null or usage_limit_per_email > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);

-- 4D agregará el ledger de usos con FK obligatoria a web_orders. Los límites
-- ya forman parte del contrato, pero 4C no reserva ni consume códigos.
alter table public.web_carts add column selected_discount_code_id uuid references public.web_discount_codes(id) on delete set null;

create table public.web_shipping_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  name text not null check (nullif(trim(name), '') is not null),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.web_shipping_regions (
  code text primary key check (code ~ '^CL-[A-Z0-9]{2,3}$'),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.web_shipping_zone_rules (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.web_shipping_zones(id) on delete restrict,
  match_type text not null check (match_type in ('pickup', 'region', 'commune', 'fallback')),
  region_code text references public.web_shipping_regions(code) on delete restrict,
  commune_key text,
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (match_type in ('pickup', 'fallback') and region_code is null and commune_key is null)
    or (match_type = 'region' and region_code is not null and commune_key is null)
    or (match_type = 'commune' and region_code is not null and commune_key is not null and commune_key ~ '^[a-z0-9-]{2,80}$')
  )
);
create unique index web_shipping_rule_pickup_unique on public.web_shipping_zone_rules(match_type) where match_type = 'pickup' and active;
create unique index web_shipping_rule_fallback_unique on public.web_shipping_zone_rules(match_type) where match_type = 'fallback' and active;
create unique index web_shipping_rule_region_unique on public.web_shipping_zone_rules(region_code) where match_type = 'region' and active;
create unique index web_shipping_rule_commune_unique on public.web_shipping_zone_rules(region_code, commune_key) where match_type = 'commune' and active;

create table public.web_shipping_rates (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.web_shipping_zones(id) on delete restrict,
  amount numeric(12,0) not null check (amount >= 0),
  currency text not null default 'CLP' check (currency = 'CLP'),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or starts_at < ends_at)
);
create unique index web_shipping_rates_one_open_idx on public.web_shipping_rates(zone_id) where active and ends_at is null;

create trigger web_promotions_updated_at before update on public.web_promotions for each row execute function public.set_updated_at();
create trigger web_discount_codes_updated_at before update on public.web_discount_codes for each row execute function public.set_updated_at();
create trigger web_shipping_zones_updated_at before update on public.web_shipping_zones for each row execute function public.set_updated_at();
create trigger web_shipping_zone_rules_updated_at before update on public.web_shipping_zone_rules for each row execute function public.set_updated_at();
create trigger web_shipping_rates_updated_at before update on public.web_shipping_rates for each row execute function public.set_updated_at();

alter table public.web_promotions enable row level security;
alter table public.web_promotion_targets enable row level security;
alter table public.web_discount_codes enable row level security;
alter table public.web_shipping_zones enable row level security;
alter table public.web_shipping_regions enable row level security;
alter table public.web_shipping_zone_rules enable row level security;
alter table public.web_shipping_rates enable row level security;
revoke all on table public.web_promotions, public.web_promotion_targets, public.web_discount_codes,
  public.web_shipping_zones, public.web_shipping_regions, public.web_shipping_zone_rules, public.web_shipping_rates
  from public, anon, authenticated;
grant select, insert, update, delete on table public.web_promotions, public.web_promotion_targets, public.web_discount_codes,
  public.web_shipping_zones, public.web_shipping_regions, public.web_shipping_zone_rules, public.web_shipping_rates to service_role;

insert into public.web_shipping_zones(code, name) values
  ('PICKUP', 'Retiro'), ('RM', 'Región Metropolitana'), ('REGIONS', 'Regiones'), ('EXTREME', 'Regiones extremas');
insert into public.web_shipping_regions(code, name) values
  ('CL-AP', 'Arica y Parinacota'), ('CL-TA', 'Tarapacá'), ('CL-AN', 'Antofagasta'), ('CL-AT', 'Atacama'),
  ('CL-CO', 'Coquimbo'), ('CL-VS', 'Valparaíso'), ('CL-RM', 'Región Metropolitana de Santiago'),
  ('CL-LI', 'Libertador General Bernardo O''Higgins'), ('CL-ML', 'Maule'), ('CL-NB', 'Ñuble'),
  ('CL-BI', 'Biobío'), ('CL-AR', 'La Araucanía'), ('CL-LR', 'Los Ríos'), ('CL-LL', 'Los Lagos'),
  ('CL-AI', 'Aysén del General Carlos Ibáñez del Campo'), ('CL-MA', 'Magallanes y de la Antártica Chilena');
insert into public.web_shipping_zone_rules(zone_id, match_type, region_code, priority)
select id, 'pickup', null, 1000 from public.web_shipping_zones where code = 'PICKUP'
union all select id, 'region', 'CL-RM', 100 from public.web_shipping_zones where code = 'RM'
union all select id, 'fallback', null, 0 from public.web_shipping_zones where code = 'REGIONS';
insert into public.web_shipping_rates(zone_id, amount)
select id, case code when 'PICKUP' then 0 when 'RM' then 3990 when 'REGIONS' then 6990 else 8990 end
from public.web_shipping_zones;

create or replace function public.normalize_web_discount_code(p_code text)
returns text language sql immutable security definer set search_path = '' as $$
  select nullif(upper(trim(coalesce(p_code, ''))), '');
$$;
alter function public.normalize_web_discount_code(text) owner to postgres;
revoke all on function public.normalize_web_discount_code(text) from public, anon, authenticated;
grant execute on function public.normalize_web_discount_code(text) to service_role;

create or replace function public.set_web_cart_discount_code(p_token_hash text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare selected_code public.web_discount_codes%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid cart session'; end if;
  if public.normalize_web_discount_code(p_code) is null then
    update public.web_carts cart set selected_discount_code_id = null
    from public.web_sessions session where session.id = cart.session_id and session.token_hash = p_token_hash and cart.status = 'open';
    return public.web_cart_snapshot(p_token_hash);
  end if;
  select code.* into selected_code from public.web_discount_codes code
  join public.web_promotions promotion on promotion.id = code.promotion_id
  where code.code = public.normalize_web_discount_code(p_code) and code.active
    and (code.starts_at is null or code.starts_at <= now()) and (code.ends_at is null or code.ends_at > now())
    and promotion.activation_type = 'code' and promotion.status = 'active'
    and (promotion.starts_at is null or promotion.starts_at <= now()) and (promotion.ends_at is null or promotion.ends_at > now());
  if not found then raise exception 'Invalid or inactive discount code'; end if;
  update public.web_carts cart set selected_discount_code_id = selected_code.id
  from public.web_sessions session
  where session.id = cart.session_id and session.token_hash = p_token_hash and session.status = 'active'
    and session.expires_at > now() and cart.status = 'open' and cart.expires_at > now();
  if not found then raise exception 'Open cart not found'; end if;
  return public.web_cart_snapshot(p_token_hash);
end;
$$;
alter function public.set_web_cart_discount_code(text, text) owner to postgres;
revoke all on function public.set_web_cart_discount_code(text, text) from public, anon, authenticated;
grant execute on function public.set_web_cart_discount_code(text, text) to service_role;

create or replace function public.web_cart_snapshot(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with selected_session as (
    select session.id from public.web_sessions session
    where session.token_hash = p_token_hash and session.status = 'active' and session.expires_at > now()
  ), selected_cart as (
    select cart.id, cart.currency, cart.selected_discount_code_id
    from public.web_carts cart join selected_session session on session.id = cart.session_id
    where cart.status = 'open' and cart.expires_at > now() limit 1
  ), current_items as (
    select item.id as item_id, product.id as product_id, variant.id as variant_id, product.category_id, product.brand_id,
      product.name, product.slug, brand.slug as brand_slug, variant.color, variant.size,
      product.price::numeric(12,0) as unit_price, item.quantity, (product.price * item.quantity)::numeric(12,0) as line_subtotal,
      (product.active and product.publication_status = 'published' and brand.active and category.active
        and variant.active and public.web_variant_available_stock(variant.id) >= item.quantity) as available,
      image.image_url
    from selected_cart cart join public.web_cart_items item on item.cart_id = cart.id
    join public.products product on product.id = item.product_id
    join public.product_variants variant on variant.id = item.variant_id and variant.product_id = product.id
    join public.brands brand on brand.id = product.brand_id
    join public.categories category on category.id = product.category_id and category.brand_id = brand.id
    left join lateral (select product_image.image_url from public.product_images product_image
      where product_image.product_id = product.id and product_image.status = 'ready'
      order by product_image.position, product_image.id limit 1) image on true
  ), cart_total as (select coalesce(sum(line_subtotal), 0)::numeric(12,0) as subtotal from current_items),
  candidates as (
    select promotion.id, promotion.name, promotion.priority, promotion.created_at, promotion.discount_percentage,
      code.code, sum(round(item.line_subtotal * promotion.discount_percentage / 100.0))::numeric(12,0) as discount_amount
    from public.web_promotions promotion cross join cart_total total
    left join public.web_discount_codes code on code.promotion_id = promotion.id
      and code.id = (select selected_discount_code_id from selected_cart) and code.active
      and (code.starts_at is null or code.starts_at <= now()) and (code.ends_at is null or code.ends_at > now())
    join current_items item on
      (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'product')
        or exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'product' and t.product_id = item.product_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'category')
        or exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'category' and t.category_id = item.category_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'brand')
        or exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'brand' and t.brand_id = item.brand_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'color')
        or exists (select 1 from public.web_promotion_targets t where t.promotion_id = promotion.id and t.target_type = 'color' and lower(trim(t.color)) = lower(trim(item.color))))
    where promotion.status = 'active' and total.subtotal >= promotion.minimum_subtotal
      and (promotion.starts_at is null or promotion.starts_at <= now()) and (promotion.ends_at is null or promotion.ends_at > now())
      and ((promotion.activation_type = 'automatic' and code.id is null) or (promotion.activation_type = 'code' and code.id is not null))
    group by promotion.id, promotion.name, promotion.priority, promotion.created_at, promotion.discount_percentage, code.code
  ), winner as (
    select * from candidates where discount_amount > 0
    order by discount_amount desc, priority desc, created_at asc, id asc limit 1
  ), priced_items as (
    select item.*, coalesce(round(item.line_subtotal * winner.discount_percentage / 100.0), 0)::numeric(12,0) as discount_amount
    from current_items item left join winner on
      (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'product') or exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'product' and t.product_id = item.product_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'category') or exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'category' and t.category_id = item.category_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'brand') or exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'brand' and t.brand_id = item.brand_id))
      and (not exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'color') or exists (select 1 from public.web_promotion_targets t where t.promotion_id = winner.id and t.target_type = 'color' and lower(trim(t.color)) = lower(trim(item.color))))
  )
  select jsonb_build_object(
    'cartId', (select id from selected_cart), 'currency', coalesce((select currency from selected_cart), 'CLP'),
    'count', coalesce((select sum(quantity) from priced_items), 0),
    'listSubtotal', (select subtotal from cart_total),
    'discountAmount', coalesce((select discount_amount from winner), 0),
    'productsTotal', (select subtotal from cart_total) - coalesce((select discount_amount from winner), 0),
    'estimatedTotal', (select subtotal from cart_total) - coalesce((select discount_amount from winner), 0),
    'promotion', case when exists(select 1 from winner) then (select jsonb_build_object('id', id, 'name', name, 'code', code) from winner) else null end,
    'discountCode', (select code from public.web_discount_codes where id = (select selected_discount_code_id from selected_cart)),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'itemId', item_id, 'productId', product_id, 'variantId', variant_id, 'name', name, 'slug', slug,
      'brandSlug', brand_slug, 'color', color, 'size', size, 'imageUrl', image_url,
      'unitPrice', unit_price, 'quantity', quantity, 'subtotal', line_subtotal,
      'discountAmount', discount_amount, 'total', line_subtotal - discount_amount, 'available', available
    ) order by item_id) from priced_items), '[]'::jsonb)
  );
$$;
alter function public.web_cart_snapshot(text) owner to postgres;
revoke all on function public.web_cart_snapshot(text) from public, anon, authenticated;
grant execute on function public.web_cart_snapshot(text) to service_role;

create or replace function public.list_web_shipping_regions()
returns table (region_code text, region_name text)
language sql stable security definer set search_path = '' as $$
  select region.code, region.name from public.web_shipping_regions region where region.active order by region.name;
$$;
alter function public.list_web_shipping_regions() owner to postgres;
revoke all on function public.list_web_shipping_regions() from public, anon, authenticated;
grant execute on function public.list_web_shipping_regions() to service_role;

create or replace function public.resolve_web_shipping(p_method text, p_region_code text default null, p_commune text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare selected_zone public.web_shipping_zones%rowtype; selected_rate public.web_shipping_rates%rowtype; normalized_commune text;
begin
  if p_method not in ('pickup', 'shipping') then raise exception 'Invalid shipping method'; end if;
  if p_method = 'shipping' and not exists(select 1 from public.web_shipping_regions where code = p_region_code and active) then raise exception 'Invalid shipping region'; end if;
  if p_commune is not null and (length(trim(p_commune)) < 2 or length(trim(p_commune)) > 80) then raise exception 'Invalid commune'; end if;
  normalized_commune := trim(both '-' from regexp_replace(public.catalog_slugify(coalesce(p_commune, '')), '-+', '-', 'g'));
  select zone.* into selected_zone from public.web_shipping_zone_rules rule
  join public.web_shipping_zones zone on zone.id = rule.zone_id and zone.active
  where rule.active and ((p_method = 'pickup' and rule.match_type = 'pickup') or (p_method = 'shipping' and (
    (rule.match_type = 'commune' and rule.region_code = p_region_code and rule.commune_key = normalized_commune)
    or (rule.match_type = 'region' and rule.region_code = p_region_code) or rule.match_type = 'fallback')))
  order by case rule.match_type when 'pickup' then 4 when 'commune' then 3 when 'region' then 2 else 1 end desc,
    rule.priority desc, rule.created_at asc, rule.id asc limit 1;
  if not found then raise exception 'Shipping zone not configured'; end if;
  select rate.* into selected_rate from public.web_shipping_rates rate where rate.zone_id = selected_zone.id and rate.active
    and (rate.starts_at is null or rate.starts_at <= now()) and (rate.ends_at is null or rate.ends_at > now())
  order by rate.starts_at desc nulls last, rate.created_at asc, rate.id asc limit 1;
  if not found then raise exception 'Shipping rate not configured'; end if;
  return jsonb_build_object('zoneCode', selected_zone.code, 'zoneName', selected_zone.name,
    'amount', selected_rate.amount, 'currency', selected_rate.currency, 'method', p_method);
end;
$$;
alter function public.resolve_web_shipping(text, text, text) owner to postgres;
revoke all on function public.resolve_web_shipping(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_web_shipping(text, text, text) to service_role;

comment on table public.web_promotions is 'Motor web autoritativo. 4C elige un único ganador; stackable queda reservado para reglas futuras.';
comment on table public.web_shipping_zone_rules is 'EXTREME existe sin territorios hasta que negocio defina explícitamente regiones o comunas extremas.';

commit;
