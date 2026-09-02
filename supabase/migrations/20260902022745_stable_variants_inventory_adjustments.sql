begin;

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null check (movement_type in ('adjustment', 'sale', 'return', 'correction')),
  quantity_delta integer not null check (quantity_delta <> 0),
  stock_before integer not null check (stock_before >= 0),
  stock_after integer not null check (stock_after >= 0 and stock_after = stock_before + quantity_delta),
  reason text not null check (length(trim(reason)) between 1 and 500),
  source text not null check (length(trim(source)) between 1 and 100),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, idempotency_key)
);

create index inventory_movements_variant_created_idx
  on public.inventory_movements(variant_id, created_at desc);

alter table public.inventory_movements enable row level security;
revoke all on table public.inventory_movements from public, anon, authenticated;

comment on table public.inventory_movements is
  'Ledger inmutable de cambios físicos de stock. Las variantes y sus UUID no deben eliminarse ni reconstruirse.';
comment on column public.inventory_movements.idempotency_key is
  'Clave única por actor. Repetir exactamente el mismo ajuste devuelve el movimiento original.';

-- authenticated conserva lectura administrativa, pero no puede eludir el ledger.
revoke insert, update, delete on table public.product_variants from authenticated;

-- Implementación privada descriptiva. No delega en la cadena legacy que hacía
-- DELETE + INSERT de variantes. Las imágenes Storage siguen bajo sus RPC 3A.
create or replace function public.save_catalog_product_stable_core(
  p_product jsonb,
  p_variants jsonb,
  p_images jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
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
  requested_variant_id uuid;
  submitted_variant_ids uuid[] := '{}'::uuid[];
  existing_variant_product_id uuid;
  storage_max_position integer;
  legacy_position integer;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  if jsonb_typeof(coalesce(p_variants, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) = 0 then
    raise check_violation using message = 'El producto debe conservar al menos una variante';
  end if;

  select * into existing_product from public.products where id = saved_id for update;
  is_existing := found;
  select id into default_brand_id from public.brands where code = 'COLUMPIO_MUJER';

  if p_product ? 'brand_id' then
    if jsonb_typeof(p_product->'brand_id') = 'null' or nullif(trim(p_product->>'brand_id'), '') is null then
      raise not_null_violation using message = 'La marca no puede quedar vacía';
    end if;
    desired_brand_id := (p_product->>'brand_id')::uuid;
  elsif is_existing then desired_brand_id := existing_product.brand_id;
  else desired_brand_id := default_brand_id;
  end if;

  if p_product ? 'category_id' then
    desired_category_id := case when jsonb_typeof(p_product->'category_id') = 'null' or nullif(trim(p_product->>'category_id'), '') is null
      then null else (p_product->>'category_id')::uuid end;
  elsif is_existing then desired_category_id := existing_product.category_id;
  end if;

  if p_product ? 'slug' then
    if jsonb_typeof(p_product->'slug') = 'null' or nullif(trim(p_product->>'slug'), '') is null then
      raise not_null_violation using message = 'El slug no puede quedar vacío';
    end if;
    desired_slug := public.catalog_slugify(p_product->>'slug');
  elsif is_existing then desired_slug := existing_product.slug;
  else desired_slug := public.catalog_slugify(p_product->>'name');
  end if;
  if desired_slug = '' then raise check_violation using message = 'El slug no puede quedar vacío'; end if;

  if p_product ? 'publication_status' then
    if jsonb_typeof(p_product->'publication_status') = 'null' then raise not_null_violation; end if;
    desired_status := p_product->>'publication_status';
  elsif is_existing then desired_status := existing_product.publication_status;
  else desired_status := 'draft';
  end if;
  if desired_status not in ('draft', 'ready', 'published', 'archived') then raise check_violation using message = 'Estado editorial no permitido'; end if;
  if desired_status = 'published' and (not is_existing or existing_product.publication_status <> 'published') then
    raise check_violation using message = 'Usa publish_catalog_product para publicar';
  end if;

  desired_short_description := case when p_product ? 'short_description' then coalesce(trim(p_product->>'short_description'), '') when is_existing then existing_product.short_description else '' end;
  desired_seo_title := case when p_product ? 'seo_title' then coalesce(trim(p_product->>'seo_title'), '') when is_existing then existing_product.seo_title else '' end;
  desired_seo_description := case when p_product ? 'seo_description' then coalesce(trim(p_product->>'seo_description'), '') when is_existing then existing_product.seo_description else '' end;
  desired_published_at := case when desired_status = 'published' then existing_product.published_at else null end;

  insert into public.products (
    id, sku, name, description, category, subcategory, price, style, season, formality, fit, material,
    occasions, active, brand_id, category_id, slug, short_description, publication_status, published_at,
    seo_title, seo_description
  ) values (
    saved_id, upper(trim(p_product->>'sku')), trim(p_product->>'name'), coalesce(trim(p_product->>'description'), ''),
    trim(p_product->>'category'), coalesce(trim(p_product->>'subcategory'), ''), (p_product->>'price')::numeric,
    coalesce(trim(p_product->>'style'), ''), coalesce(trim(p_product->>'season'), ''), coalesce(trim(p_product->>'formality'), ''),
    coalesce(trim(p_product->>'fit'), ''), coalesce(trim(p_product->>'material'), ''),
    coalesce(array(select jsonb_array_elements_text(p_product->'occasions')), '{}'::text[]),
    coalesce((p_product->>'active')::boolean, true), desired_brand_id, desired_category_id, desired_slug,
    desired_short_description, desired_status, desired_published_at, desired_seo_title, desired_seo_description
  )
  on conflict (id) do update set
    sku=excluded.sku, name=excluded.name, description=excluded.description, category=excluded.category,
    subcategory=excluded.subcategory, price=excluded.price, style=excluded.style, season=excluded.season,
    formality=excluded.formality, fit=excluded.fit, material=excluded.material, occasions=excluded.occasions,
    active=excluded.active, brand_id=excluded.brand_id, category_id=excluded.category_id, slug=excluded.slug,
    short_description=excluded.short_description, publication_status=excluded.publication_status,
    published_at=excluded.published_at, seo_title=excluded.seo_title, seo_description=excluded.seo_description;

  for item in select value from jsonb_array_elements(p_variants)
  loop
    requested_variant_id := coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid());
    if requested_variant_id = any(submitted_variant_ids) then raise unique_violation using message = 'Una variante no puede repetirse'; end if;
    submitted_variant_ids := array_append(submitted_variant_ids, requested_variant_id);
    select variant.product_id into existing_variant_product_id from public.product_variants variant where variant.id = requested_variant_id for update;
    if found and existing_variant_product_id <> saved_id then raise foreign_key_violation using message = 'La variante pertenece a otro producto'; end if;
    if found then
      update public.product_variants variant set
        variant_sku=upper(trim(item->>'variant_sku')), color=trim(item->>'color'), size=trim(item->>'size'),
        active=coalesce((item->>'active')::boolean, true)
      where variant.id = requested_variant_id;
    else
      insert into public.product_variants(id, product_id, variant_sku, color, size, stock, active)
      values(requested_variant_id, saved_id, upper(trim(item->>'variant_sku')), trim(item->>'color'), trim(item->>'size'), 0, true);
    end if;
  end loop;

  update public.product_variants variant set active = false
  where variant.product_id = saved_id and variant.active and not (variant.id = any(submitted_variant_ids));

  -- Solo reemplaza imágenes legacy; jamás toca filas Storage.
  select coalesce(max(image.position), -1) into storage_max_position
  from public.product_images image where image.product_id = saved_id and image.storage_path is not null;
  delete from public.product_images image where image.product_id = saved_id and image.storage_path is null;
  legacy_position := storage_max_position;
  for item in select value from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
  loop
    legacy_position := legacy_position + 1;
    insert into public.product_images(id, product_id, image_url, position, alt_text)
    values(coalesce(nullif(item->>'id', '')::uuid, gen_random_uuid()), saved_id, trim(item->>'image_url'), legacy_position, coalesce(trim(item->>'alt_text'), ''));
  end loop;

  if desired_status in ('ready', 'published') and not public.catalog_product_is_complete(saved_id) then
    raise check_violation using message = 'El producto no cumple los requisitos editoriales';
  end if;
  return saved_id;
end;
$$;

alter function public.save_catalog_product_stable_core(jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.save_catalog_product_stable_core(jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Mantiene la firma pública y el contrato foto-first de 3B.
create or replace function public.save_catalog_product(
  p_product jsonb,
  p_variants jsonb,
  p_images jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  product_id uuid := nullif(p_product->>'id', '')::uuid;
  prior_setup_status text;
  requested_status text := coalesce(nullif(p_product->>'publication_status', ''), 'draft');
  requested_active boolean := coalesce((p_product->>'active')::boolean, false);
  safe_product jsonb := p_product;
  saved_id uuid;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if product_id is not null then select setup_status into prior_setup_status from public.products where id=product_id for update; end if;
  if prior_setup_status in ('technical_draft', 'in_progress') and requested_status='ready' then
    safe_product := jsonb_set(safe_product, '{publication_status}', '"draft"'::jsonb, true);
  end if;
  if prior_setup_status in ('technical_draft', 'in_progress') then
    safe_product := jsonb_set(safe_product, '{active}', 'false'::jsonb, true);
  end if;
  if prior_setup_status='technical_draft' then update public.products set setup_status='in_progress' where id=product_id; end if;

  saved_id := public.save_catalog_product_stable_core(safe_product, p_variants, p_images);

  if prior_setup_status in ('technical_draft', 'in_progress') then
    if public.catalog_product_setup_is_complete(saved_id) then
      perform pg_catalog.set_config('columpio.complete_product_setup', 'on', true);
      update public.products set setup_status='complete', active=requested_active, setup_expires_at=null where id=saved_id;
      if requested_status='ready' and requested_active then
        update public.products set publication_status='ready', published_at=null where id=saved_id;
      end if;
    else
      update public.products set setup_status='in_progress', active=false, publication_status='draft', published_at=null,
        setup_expires_at=now()+interval '7 days' where id=saved_id;
    end if;
  end if;
  return saved_id;
end;
$$;

alter function public.save_catalog_product(jsonb, jsonb, jsonb) owner to postgres;
revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.adjust_variant_stock(
  p_variant_id uuid,
  p_quantity_delta integer,
  p_expected_stock integer,
  p_reason text,
  p_idempotency_key uuid,
  p_source text default 'catalog_admin'
)
returns table (movement_id uuid, stock_before integer, stock_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_stock integer;
  new_stock integer;
  prior public.inventory_movements%rowtype;
  created_id uuid;
  normalized_source text := coalesce(nullif(trim(p_source),''),'catalog_admin');
begin
  if actor_id is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if p_quantity_delta is null or p_quantity_delta=0 then raise check_violation using message = 'El ajuste debe ser distinto de cero'; end if;
  if p_expected_stock is null or p_expected_stock<0 then raise check_violation using message = 'Stock esperado inválido'; end if;
  if nullif(trim(p_reason), '') is null then raise check_violation using message = 'El motivo es obligatorio'; end if;
  if p_idempotency_key is null then raise not_null_violation using message = 'La clave de idempotencia es obligatoria'; end if;

  -- Serializa también dos primeras solicitudes concurrentes con la misma clave.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor_id::text || ':' || p_idempotency_key::text, 0));
  select * into prior from public.inventory_movements movement
  where movement.actor_user_id=actor_id and movement.idempotency_key=p_idempotency_key;
  if found then
    if prior.variant_id<>p_variant_id or prior.quantity_delta<>p_quantity_delta or prior.stock_before<>p_expected_stock
      or prior.reason<>trim(p_reason) or prior.source<>normalized_source then
      raise unique_violation using message = 'La clave de idempotencia ya fue usada con otros datos';
    end if;
    return query select prior.id, prior.stock_before, prior.stock_after;
    return;
  end if;

  select variant.stock into current_stock from public.product_variants variant where variant.id=p_variant_id for update;
  if not found then raise no_data_found using message = 'Variante no encontrada'; end if;
  if current_stock<>p_expected_stock then raise serialization_failure using message = 'El stock cambió; recarga antes de ajustar'; end if;
  new_stock := current_stock+p_quantity_delta;
  if new_stock<0 then raise check_violation using message = 'El stock no puede quedar negativo'; end if;

  update public.product_variants set stock=new_stock where id=p_variant_id;
  insert into public.inventory_movements(variant_id,movement_type,quantity_delta,stock_before,stock_after,reason,source,actor_user_id,idempotency_key)
  values(p_variant_id,'adjustment',p_quantity_delta,current_stock,new_stock,trim(p_reason),normalized_source,actor_id,p_idempotency_key)
  returning id into created_id;
  return query select created_id,current_stock,new_stock;
end;
$$;

alter function public.adjust_variant_stock(uuid, integer, integer, text, uuid, text) owner to postgres;
revoke all on function public.adjust_variant_stock(uuid, integer, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.adjust_variant_stock(uuid, integer, integer, text, uuid, text) to authenticated;

commit;
