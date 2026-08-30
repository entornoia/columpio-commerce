-- BLOQUE WEB 2 / FASE A
-- Taxonomía editorial y contrato público de catálogo. Esta migración es aditiva:
-- las columnas legacy siguen siendo la autoridad del advisor de Instagram.

begin;

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  slug text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_code_key unique (code),
  constraint brands_slug_key unique (slug),
  constraint brands_code_format check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  constraint brands_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  parent_id uuid references public.categories(id) on delete restrict,
  code text not null,
  name text not null,
  slug text not null,
  description text not null default '',
  position integer not null default 0 check (position >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_brand_code_key unique (brand_id, code),
  constraint categories_code_format check (code = upper(code) and code ~ '^[A-Z0-9_]+$'),
  constraint categories_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);

-- PostgreSQL considera distintos los NULL de un UNIQUE convencional. Estos dos
-- índices cubren por separado categorías raíz e hijas.
create unique index categories_root_slug_key
  on public.categories (brand_id, slug)
  where parent_id is null;
create unique index categories_child_slug_key
  on public.categories (brand_id, parent_id, slug)
  where parent_id is not null;
create index categories_brand_position_idx on public.categories (brand_id, position, name);

alter table public.products
  add column brand_id uuid references public.brands(id) on delete restrict,
  add column category_id uuid references public.categories(id) on delete restrict,
  add column slug text,
  add column short_description text not null default '',
  add column publication_status text not null default 'draft',
  add column published_at timestamptz,
  add column seo_title text not null default '',
  add column seo_description text not null default '',
  add constraint products_publication_status_check
    check (publication_status in ('draft', 'ready', 'published', 'archived')),
  add constraint products_publication_timestamp_check
    check (
      (publication_status = 'published' and published_at is not null)
      or (publication_status <> 'published' and published_at is null)
    );

create index products_brand_category_idx on public.products (brand_id, category_id);
create index products_publication_idx on public.products (publication_status, active, published_at desc);

create table public.product_slug_registry (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  slug text not null,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  constraint product_slug_registry_brand_slug_key unique (brand_id, slug),
  constraint product_slug_registry_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint product_slug_registry_state_check check (
    (is_current and retired_at is null) or (not is_current and retired_at is not null)
  )
);

comment on table public.product_slug_registry is
  'Reserva permanente de URLs públicas. Un producto con slug registrado no se borra físicamente: se desactiva y archiva.';

create unique index product_slug_registry_current_product_key
  on public.product_slug_registry (product_id)
  where is_current;
create index product_slug_registry_product_idx on public.product_slug_registry (product_id, created_at desc);

create table public.product_slug_history (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null unique references public.product_slug_registry(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  brand_id uuid not null references public.brands(id) on delete restrict,
  slug text not null,
  replaced_at timestamptz not null default now(),
  constraint product_slug_history_brand_slug_key unique (brand_id, slug),
  constraint product_slug_history_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index product_slug_history_product_idx on public.product_slug_history (product_id, replaced_at desc);

create or replace function public.catalog_slugify(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    translate(lower(trim(value)), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

revoke all on function public.catalog_slugify(text) from public, anon;

create or replace function public.validate_category_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_brand uuid;
  cursor_id uuid;
begin
  if exists (select 1 from public.categories child where child.parent_id = new.id and child.brand_id <> new.brand_id) then
    raise check_violation using message = 'Una categoría y sus hijas deben pertenecer a la misma marca';
  end if;
  if exists (select 1 from public.products product where product.category_id = new.id and product.brand_id <> new.brand_id) then
    raise check_violation using message = 'No se puede mover una categoría usada a otra marca';
  end if;
  if new.parent_id is null then
    return new;
  end if;

  select brand_id into parent_brand from public.categories where id = new.parent_id;
  if parent_brand is null or parent_brand <> new.brand_id then
    raise check_violation using message = 'La categoría padre debe pertenecer a la misma marca';
  end if;

  cursor_id := new.parent_id;
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise check_violation using message = 'La jerarquía de categorías no puede contener ciclos';
    end if;
    select parent_id into cursor_id from public.categories where id = cursor_id;
  end loop;
  return new;
end;
$$;

revoke all on function public.validate_category_parent() from public, anon, authenticated;

create trigger categories_validate_parent
before insert or update of brand_id, parent_id on public.categories
for each row execute function public.validate_category_parent();

create trigger brands_updated_at before update on public.brands
for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories
for each row execute function public.set_updated_at();

insert into public.brands (code, name, slug, active)
values ('COLUMPIO_MUJER', 'Columpio Mujer', 'mujer', true);

insert into public.categories (brand_id, code, name, slug, description, position)
select brand.id, category.code, category.name, category.slug, category.description, category.position
from public.brands brand
cross join (values
  ('VESTIDOS', 'Vestidos', 'vestidos', 'Siluetas femeninas para momentos cotidianos y ocasiones especiales.', 10),
  ('BLUSAS', 'Blusas', 'blusas', 'Texturas suaves y detalles que transforman cada combinación.', 20),
  ('POLERAS', 'Poleras', 'poleras', 'Esenciales cómodos con el sello cálido de Columpio.', 30),
  ('PANTALONES', 'Pantalones', 'pantalones', 'Calces contemporáneos para vestir a tu manera.', 40),
  ('CHAQUETAS', 'Chaquetas', 'chaquetas', 'Capas versátiles que completan tu look.', 50),
  ('ACCESORIOS', 'Accesorios', 'accesorios', 'Pequeños acentos para hacer tuyo cada outfit.', 60)
) as category(code, name, slug, description, position)
where brand.code = 'COLUMPIO_MUJER';

update public.products
set brand_id = (select id from public.brands where code = 'COLUMPIO_MUJER');

-- El mapeo consulta category y subcategory, pero no los modifica.
with normalized as (
  select
    product.id,
    product.brand_id,
    public.catalog_slugify(product.category) as legacy_category,
    public.catalog_slugify(product.subcategory) as legacy_subcategory
  from public.products product
)
update public.products product
set category_id = category.id
from normalized source
join public.categories category
  on category.brand_id = source.brand_id
 and category.slug = case
   when source.legacy_subcategory in ('vestido', 'vestidos') or source.legacy_category in ('vestido', 'vestidos') then 'vestidos'
   when source.legacy_subcategory in ('blusa', 'blusas') or source.legacy_category in ('blusa', 'blusas') then 'blusas'
   when source.legacy_subcategory in ('polera', 'poleras') or source.legacy_category in ('polera', 'poleras') then 'poleras'
   when source.legacy_subcategory in ('pantalon', 'pantalones') or source.legacy_category in ('pantalon', 'pantalones') then 'pantalones'
   when source.legacy_subcategory in ('chaqueta', 'chaquetas', 'blazer', 'blazers') or source.legacy_category in ('chaqueta', 'chaquetas', 'blazer', 'blazers') then 'chaquetas'
   when source.legacy_subcategory in ('accesorio', 'accesorios') or source.legacy_category in ('accesorio', 'accesorios') then 'accesorios'
   else null
 end
where product.id = source.id;

create or replace function public.register_product_slug_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is not null then
    insert into public.product_slug_registry (brand_id, product_id, slug, is_current)
    values (new.brand_id, new.id, new.slug, true);
  end if;
  return new;
end;
$$;

revoke all on function public.register_product_slug_after_insert() from public, anon, authenticated;

create or replace function public.change_product_slug_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_registry public.product_slug_registry%rowtype;
begin
  if new.slug is not distinct from old.slug and new.brand_id is not distinct from old.brand_id then
    return new;
  end if;
  if new.slug is null or new.brand_id is null then
    raise not_null_violation using message = 'Marca y slug son obligatorios';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(old.id::text, 0));
  select * into old_registry
  from public.product_slug_registry
  where product_id = old.id and is_current
  for update;

  if old.slug is not null and not found then
    raise integrity_constraint_violation using message = 'Falta el slug actual en el registry';
  end if;
  if found and (old_registry.slug <> old.slug or old_registry.brand_id <> old.brand_id) then
    raise integrity_constraint_violation using message = 'El slug actual no coincide con el registry';
  end if;

  if found then
    update public.product_slug_registry
    set is_current = false, retired_at = now()
    where id = old_registry.id;
    insert into public.product_slug_history (registry_id, product_id, brand_id, slug, replaced_at)
    values (old_registry.id, old.id, old_registry.brand_id, old_registry.slug, now());
  end if;

  insert into public.product_slug_registry (brand_id, product_id, slug, is_current)
  values (new.brand_id, old.id, new.slug, true);
  return new;
end;
$$;

revoke all on function public.change_product_slug_before_update() from public, anon, authenticated;

create trigger products_register_slug_after_insert
after insert on public.products
for each row execute function public.register_product_slug_after_insert();
create trigger products_change_slug_before_update
before update of brand_id, slug on public.products
for each row execute function public.change_product_slug_before_update();

-- Slugs deterministas. Los sufijos se usan sólo ante una colisión y quedan
-- reservados para siempre en product_slug_registry.
do $$
declare
  item record;
  base_slug text;
  candidate text;
begin
  for item in
    select id, name, sku
    from public.products
    order by created_at, id
  loop
    base_slug := public.catalog_slugify(item.name);
    if base_slug = '' then base_slug := 'producto'; end if;
    candidate := base_slug;
    if exists (select 1 from public.product_slug_registry where brand_id = (select brand_id from public.products where id = item.id) and slug = candidate) then
      candidate := base_slug || '-' || public.catalog_slugify(item.sku);
    end if;
    if candidate = base_slug || '-' or exists (select 1 from public.product_slug_registry where brand_id = (select brand_id from public.products where id = item.id) and slug = candidate) then
      candidate := base_slug || '-' || replace(item.id::text, '-', '');
    end if;
    update public.products set slug = candidate where id = item.id;
  end loop;
end;
$$;

alter table public.products
  alter column brand_id set not null,
  alter column slug set not null,
  add constraint products_slug_format check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

create or replace function public.validate_product_slug_integrity_deferred()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_product_id uuid;
begin
  target_product_id := coalesce(
    nullif(to_jsonb(new)->>'product_id', '')::uuid,
    nullif(to_jsonb(old)->>'product_id', '')::uuid,
    nullif(to_jsonb(new)->>'id', '')::uuid,
    nullif(to_jsonb(old)->>'id', '')::uuid
  );
  if exists (select 1 from public.products where id = target_product_id) then
    if (select count(*) from public.product_slug_registry where product_id = target_product_id and is_current) <> 1 then
      raise integrity_constraint_violation using message = 'Cada producto debe tener exactamente un slug actual';
    end if;
    if not exists (
      select 1
      from public.products product
      join public.product_slug_registry registry
        on registry.product_id = product.id and registry.is_current
       and registry.brand_id = product.brand_id and registry.slug = product.slug
      where product.id = target_product_id
    ) then
      raise integrity_constraint_violation using message = 'products.slug no coincide con el registry actual';
    end if;
    if exists (
      select 1
      from public.product_slug_registry registry
      left join public.product_slug_history history
        on history.registry_id = registry.id and history.product_id = registry.product_id
       and history.brand_id = registry.brand_id and history.slug = registry.slug
      where registry.product_id = target_product_id and not registry.is_current and history.id is null
    ) then
      raise integrity_constraint_violation using message = 'Todo slug retirado debe conservar historial';
    end if;
    if exists (
      select 1
      from public.product_slug_history history
      left join public.product_slug_registry registry
        on registry.id = history.registry_id and registry.product_id = history.product_id
       and registry.brand_id = history.brand_id and registry.slug = history.slug and not registry.is_current
      where history.product_id = target_product_id and registry.id is null
    ) then
      raise integrity_constraint_violation using message = 'El historial debe corresponder a un slug retirado';
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.validate_product_slug_integrity_deferred() from public, anon, authenticated;

create or replace function public.protect_product_slug_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is distinct from old.product_id
    or new.brand_id is distinct from old.brand_id
    or new.slug is distinct from old.slug
  then
    raise integrity_constraint_violation using message = 'La identidad de un slug reservado es inmutable';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_product_slug_identity() from public, anon, authenticated;

create trigger registry_protect_slug_identity
before update on public.product_slug_registry
for each row execute function public.protect_product_slug_identity();
create trigger history_protect_slug_identity
before update on public.product_slug_history
for each row execute function public.protect_product_slug_identity();

create constraint trigger products_slug_integrity_deferred
after insert or update of brand_id, slug on public.products
deferrable initially deferred
for each row execute function public.validate_product_slug_integrity_deferred();
create constraint trigger registry_slug_integrity_deferred
after insert or update or delete on public.product_slug_registry
deferrable initially deferred
for each row execute function public.validate_product_slug_integrity_deferred();
create constraint trigger history_slug_integrity_deferred
after insert or update or delete on public.product_slug_history
deferrable initially deferred
for each row execute function public.validate_product_slug_integrity_deferred();

create or replace function public.catalog_product_is_complete(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.products product
    where product.id = p_product_id
      and product.active
      and product.brand_id is not null
      and product.category_id is not null
      and nullif(trim(product.slug), '') is not null
      and nullif(trim(product.sku), '') is not null
      and nullif(trim(product.name), '') is not null
      and nullif(trim(product.description), '') is not null
      and product.price >= 0
      and exists (
        select 1 from public.brands brand
        where brand.id = product.brand_id and brand.active
      )
      and exists (
        select 1 from public.categories category
        where category.id = product.category_id
          and category.brand_id = product.brand_id
          and category.active
      )
      and exists (
        select 1 from public.product_variants variant
        where variant.product_id = product.id
          and variant.active
          and nullif(trim(variant.variant_sku), '') is not null
          and nullif(trim(variant.color), '') is not null
          and nullif(trim(variant.size), '') is not null
          and variant.stock >= 0
      )
  );
$$;

revoke all on function public.catalog_product_is_complete(uuid) from public, anon;

update public.products product
set
  publication_status = case when public.catalog_product_is_complete(product.id) then 'ready' else 'draft' end,
  published_at = null;

create or replace function public.validate_product_taxonomy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories category
    where category.id = new.category_id and category.brand_id = new.brand_id
  ) then
    raise foreign_key_violation using message = 'La categoría debe pertenecer a la marca del producto';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_product_taxonomy() from public, anon, authenticated;

create trigger products_validate_taxonomy
before insert or update of brand_id, category_id on public.products
for each row execute function public.validate_product_taxonomy();

-- Conserva la firma original y todos los campos legacy. Guardar nunca publica.
create or replace function public.save_catalog_product(
  p_product jsonb,
  p_variants jsonb,
  p_images jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid := coalesce(nullif(p_product->>'id', '')::uuid, gen_random_uuid());
  item jsonb;
  existing_product public.products%rowtype;
  is_existing boolean := false;
  desired_status text;
  default_brand_id uuid;
  desired_brand_id uuid;
  desired_category_id uuid;
  desired_slug text;
  desired_short_description text;
  desired_seo_title text;
  desired_seo_description text;
  desired_published_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  select * into existing_product from public.products where id = saved_id for update;
  is_existing := found;
  select id into default_brand_id from public.brands where code = 'COLUMPIO_MUJER';

  if p_product ? 'brand_id' then
    if jsonb_typeof(p_product->'brand_id') = 'null' or nullif(trim(p_product->>'brand_id'), '') is null then
      raise not_null_violation using message = 'La marca no puede quedar vacía';
    end if;
    desired_brand_id := (p_product->>'brand_id')::uuid;
  elsif is_existing then
    desired_brand_id := existing_product.brand_id;
  else
    desired_brand_id := default_brand_id;
  end if;

  if p_product ? 'category_id' then
    desired_category_id := case
      when jsonb_typeof(p_product->'category_id') = 'null' or nullif(trim(p_product->>'category_id'), '') is null then null
      else (p_product->>'category_id')::uuid
    end;
  elsif is_existing then
    desired_category_id := existing_product.category_id;
  else
    desired_category_id := null;
  end if;

  if p_product ? 'slug' then
    if jsonb_typeof(p_product->'slug') = 'null' or nullif(trim(p_product->>'slug'), '') is null then
      raise not_null_violation using message = 'El slug no puede quedar vacío';
    end if;
    desired_slug := public.catalog_slugify(p_product->>'slug');
  elsif is_existing then
    desired_slug := existing_product.slug;
  else
    desired_slug := public.catalog_slugify(p_product->>'name');
  end if;
  if desired_slug = '' then
    raise check_violation using message = 'El slug no puede quedar vacío';
  end if;

  if p_product ? 'publication_status' then
    if jsonb_typeof(p_product->'publication_status') = 'null' then
      raise not_null_violation using message = 'El estado editorial no puede quedar vacío';
    end if;
    desired_status := p_product->>'publication_status';
  elsif is_existing then
    desired_status := existing_product.publication_status;
  else
    desired_status := 'draft';
  end if;
  if desired_status not in ('draft', 'ready', 'published', 'archived') then
    raise check_violation using message = 'Estado editorial no permitido';
  end if;
  if desired_status = 'published' and (not is_existing or existing_product.publication_status <> 'published') then
    raise check_violation using message = 'Usa publish_catalog_product para publicar';
  end if;

  if p_product ? 'short_description' then
    if jsonb_typeof(p_product->'short_description') = 'null' then
      raise not_null_violation using message = 'La descripción corta no admite null';
    end if;
    desired_short_description := trim(p_product->>'short_description');
  else
    desired_short_description := case when is_existing then existing_product.short_description else '' end;
  end if;
  if p_product ? 'seo_title' then
    if jsonb_typeof(p_product->'seo_title') = 'null' then
      raise not_null_violation using message = 'El título SEO no admite null';
    end if;
    desired_seo_title := trim(p_product->>'seo_title');
  else
    desired_seo_title := case when is_existing then existing_product.seo_title else '' end;
  end if;
  if p_product ? 'seo_description' then
    if jsonb_typeof(p_product->'seo_description') = 'null' then
      raise not_null_violation using message = 'La descripción SEO no admite null';
    end if;
    desired_seo_description := trim(p_product->>'seo_description');
  else
    desired_seo_description := case when is_existing then existing_product.seo_description else '' end;
  end if;
  desired_published_at := case when desired_status = 'published' then existing_product.published_at else null end;

  insert into public.products (
    id, sku, name, description, category, subcategory, price, style, season,
    formality, fit, material, occasions, active, brand_id, category_id, slug,
    short_description, publication_status, published_at, seo_title, seo_description
  ) values (
    saved_id, upper(trim(p_product->>'sku')), trim(p_product->>'name'), coalesce(trim(p_product->>'description'), ''),
    trim(p_product->>'category'), coalesce(trim(p_product->>'subcategory'), ''), (p_product->>'price')::numeric,
    coalesce(trim(p_product->>'style'), ''), coalesce(trim(p_product->>'season'), ''),
    coalesce(trim(p_product->>'formality'), ''), coalesce(trim(p_product->>'fit'), ''),
    coalesce(trim(p_product->>'material'), ''),
    coalesce(array(select jsonb_array_elements_text(p_product->'occasions')), '{}'::text[]),
    coalesce((p_product->>'active')::boolean, true), desired_brand_id,
    desired_category_id, desired_slug,
    desired_short_description, desired_status, desired_published_at,
    desired_seo_title, desired_seo_description
  )
  on conflict (id) do update set
    sku = excluded.sku, name = excluded.name, description = excluded.description,
    category = excluded.category, subcategory = excluded.subcategory, price = excluded.price,
    style = excluded.style, season = excluded.season, formality = excluded.formality,
    fit = excluded.fit, material = excluded.material, occasions = excluded.occasions,
    active = excluded.active, brand_id = excluded.brand_id, category_id = excluded.category_id,
    slug = excluded.slug, short_description = excluded.short_description,
    publication_status = excluded.publication_status, published_at = excluded.published_at,
    seo_title = excluded.seo_title, seo_description = excluded.seo_description;

  delete from public.product_variants where product_id = saved_id;
  for item in select * from jsonb_array_elements(p_variants)
  loop
    insert into public.product_variants (id, product_id, variant_sku, color, size, stock, active)
    values (
      coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()), saved_id,
      upper(trim(item->>'variant_sku')), trim(item->>'color'), trim(item->>'size'),
      (item->>'stock')::integer, coalesce((item->>'active')::boolean, true)
    );
  end loop;

  delete from public.product_images where product_id = saved_id;
  for item in select * from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
  loop
    insert into public.product_images (id, product_id, image_url, position, alt_text)
    values (
      coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()), saved_id,
      trim(item->>'image_url'), (item->>'position')::integer, coalesce(trim(item->>'alt_text'), '')
    );
  end loop;

  if desired_status in ('ready', 'published') and not public.catalog_product_is_complete(saved_id) then
    raise check_violation using message = 'El producto no cumple los requisitos editoriales';
  end if;
  return saved_id;
end;
$$;

revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon;

create or replace function public.publish_catalog_product(p_product_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_status text;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  select publication_status into current_status
  from public.products
  where id = p_product_id
  for update;
  if not found then raise no_data_found using message = 'Producto no encontrado'; end if;
  if current_status = 'published' then
    if not public.catalog_product_is_complete(p_product_id) then
      raise check_violation using message = 'El producto publicado ya no cumple los requisitos editoriales';
    end if;
    return;
  end if;
  if current_status <> 'ready' then
    raise check_violation using message = 'Solo un producto ready puede publicarse';
  end if;
  if not public.catalog_product_is_complete(p_product_id) then
    raise check_violation using message = 'El producto no cumple los requisitos para publicar';
  end if;
  update public.products
  set publication_status = 'published', published_at = now()
  where id = p_product_id;
end;
$$;

revoke all on function public.publish_catalog_product(uuid) from public, anon;

create or replace function public.change_catalog_product_slug(p_product_id uuid, p_slug text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare normalized_slug text := public.catalog_slugify(p_slug);
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  if normalized_slug = '' then raise check_violation using message = 'El slug no puede quedar vacío'; end if;
  update public.products set slug = normalized_slug where id = p_product_id;
  if not found then raise no_data_found using message = 'Producto no encontrado'; end if;
  return normalized_slug;
end;
$$;

revoke all on function public.change_catalog_product_slug(uuid, text) from public, anon;

create or replace function public.list_public_products(
  p_category_slug text default null,
  p_limit integer default 24
)
returns table (
  id uuid, brand_slug text, category_slug text, category_name text, slug text,
  name text, short_description text, description text, price numeric,
  style text, material text, is_available boolean, colors jsonb, sizes jsonb, images jsonb,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.id, brand.slug, category.slug, category.name, product.slug,
    product.name, product.short_description, product.description, product.price,
    product.style, product.material,
    exists (
      select 1 from public.product_variants available_variant
      where available_variant.product_id = product.id and available_variant.active and available_variant.stock > 0
    ),
    coalesce((select jsonb_agg(distinct variant.color) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(distinct variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id), '[]'::jsonb),
    product.published_at
  from public.products product
  join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active
    and product.publication_status = 'published'
    and (p_category_slug is null or category.slug = public.catalog_slugify(p_category_slug))
  order by product.published_at desc, product.name
  limit greatest(0, least(coalesce(p_limit, 24), 100));
$$;

revoke all on function public.list_public_products(text, integer) from public, anon, authenticated;

create or replace function public.get_public_product_by_slug(p_slug text, p_brand_slug text default 'mujer')
returns table (
  id uuid, brand_slug text, brand_name text, category_slug text, category_name text,
  slug text, name text, short_description text, description text, price numeric,
  style text, material text, is_available boolean, variants jsonb, images jsonb,
  seo_title text, seo_description text, published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    product.id, brand.slug, brand.name, category.slug, category.name,
    product.slug, product.name, product.short_description, product.description, product.price,
    product.style, product.material,
    exists (
      select 1 from public.product_variants available_variant
      where available_variant.product_id = product.id and available_variant.active and available_variant.stock > 0
    ),
    coalesce((select jsonb_agg(jsonb_build_object(
      'color', variant.color, 'size', variant.size, 'available', (variant.stock > 0)
    ) order by variant.color, variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id), '[]'::jsonb),
    product.seo_title, product.seo_description, product.published_at
  from public.products product
  join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active
    and product.publication_status = 'published'
    and product.slug = public.catalog_slugify(p_slug)
    and brand.slug = public.catalog_slugify(p_brand_slug)
  limit 1;
$$;

revoke all on function public.get_public_product_by_slug(text, text) from public, anon, authenticated;

create or replace function public.list_public_categories(p_brand_slug text default 'mujer')
returns table (id uuid, slug text, name text, description text, position integer, product_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select category.id, category.slug, category.name, category.description, category.position,
    count(product.id) filter (where product.active and product.publication_status = 'published')
  from public.categories category
  join public.brands brand on brand.id = category.brand_id and brand.active
  left join public.products product on product.category_id = category.id
  where category.active and category.parent_id is null and brand.slug = public.catalog_slugify(p_brand_slug)
  group by category.id
  order by category.position, category.name;
$$;

revoke all on function public.list_public_categories(text) from public, anon, authenticated;

alter table public.brands enable row level security;
alter table public.categories enable row level security;
alter table public.product_slug_registry enable row level security;
alter table public.product_slug_history enable row level security;

revoke all on table public.brands, public.categories, public.product_slug_registry, public.product_slug_history from anon, authenticated;
grant select on table public.brands, public.categories to authenticated;

create policy "Authenticated users read brands" on public.brands for select to authenticated using (true);
create policy "Authenticated users read categories" on public.categories for select to authenticated using (true);

grant execute on function public.catalog_slugify(text) to authenticated;
grant execute on function public.catalog_product_is_complete(uuid) to authenticated;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.change_catalog_product_slug(uuid, text) to authenticated;
grant execute on function public.publish_catalog_product(uuid) to authenticated;
grant execute on function public.list_public_products(text, integer) to anon, authenticated;
grant execute on function public.get_public_product_by_slug(text, text) to anon, authenticated;
grant execute on function public.list_public_categories(text) to anon, authenticated;

-- Invariantes finales del backfill: ningún producto preexistente se publica.
do $$
begin
  if exists (select 1 from public.products where publication_status = 'published' or published_at is not null) then
    raise check_violation using message = '014 no puede publicar productos durante el backfill';
  end if;
  if exists (select 1 from public.products where brand_id is null or slug is null) then
    raise not_null_violation using message = 'Backfill incompleto de marca o slug';
  end if;
  if exists (
    select 1 from public.products product
    left join public.product_slug_registry registry
      on registry.product_id = product.id and registry.is_current
    where registry.id is null or registry.slug <> product.slug or registry.brand_id <> product.brand_id
  ) then
    raise integrity_constraint_violation using message = 'Registry de slugs inconsistente';
  end if;
end;
$$;

commit;
