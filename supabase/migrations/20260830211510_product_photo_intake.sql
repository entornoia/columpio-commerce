begin;

-- Bloque Web 3B: onboarding foto primero. El valor price = 0 sólo es válido
-- como placeholder interno mientras setup_status = technical_draft/in_progress.
alter table public.products
  add column setup_status text not null default 'complete',
  add column setup_started_at timestamptz,
  add column setup_updated_at timestamptz,
  add column setup_created_by uuid,
  add column setup_expires_at timestamptz,
  add column analysis_status text not null default 'not_started',
  add column analysis_completed_at timestamptz,
  add column analysis_model text,
  add column analysis_error text,
  add column technical_slug_releasable boolean not null default false,
  add constraint products_setup_status_check
    check (setup_status in ('technical_draft', 'in_progress', 'complete')),
  add constraint products_analysis_status_check
    check (analysis_status in ('not_started', 'processing', 'completed', 'failed')),
  add constraint products_setup_publication_check
    check (publication_status not in ('ready', 'published') or setup_status = 'complete'),
  add constraint products_ready_active_check
    check (publication_status not in ('ready', 'published') or active),
  add constraint products_technical_draft_check
    check (
      setup_status <> 'technical_draft'
      or (not active and publication_status = 'draft' and published_at is null and price = 0)
    ),
  add constraint products_incomplete_inactive_check
    check (setup_status = 'complete' or not active),
  add constraint products_complete_price_check
    check (setup_status <> 'complete' or price > 0),
  add constraint products_technical_slug_releasable_check
    check (
      not technical_slug_releasable
      or (
        setup_status in ('technical_draft', 'in_progress')
        and publication_status = 'draft' and published_at is null
        and sku ~ '^DRAFT-[0-9A-F]{32}$'
        and slug ~ '^draft-[0-9a-f]{32}$'
      )
    ),
  add constraint products_analysis_metadata_check
    check (
      (analysis_status = 'completed' and analysis_completed_at is not null and analysis_model is not null and analysis_error is null)
      or (analysis_status = 'failed' and analysis_completed_at is null and analysis_error is not null)
      or (analysis_status in ('not_started', 'processing') and analysis_completed_at is null)
    );

update public.products
set setup_status = 'complete', analysis_status = 'not_started'
where setup_status = 'complete';

create index products_setup_cleanup_idx
  on public.products (setup_status, setup_expires_at)
  where setup_status in ('technical_draft', 'in_progress');

create or replace function public.set_product_setup_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.setup_status is distinct from old.setup_status
    or new.analysis_status is distinct from old.analysis_status
    or new.analysis_completed_at is distinct from old.analysis_completed_at
    or new.analysis_model is distinct from old.analysis_model
    or new.analysis_error is distinct from old.analysis_error
  then
    new.setup_updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.set_product_setup_updated_at() from public, anon, authenticated;

create trigger products_setup_updated_at
before update on public.products
for each row execute function public.set_product_setup_updated_at();

create or replace function public.protect_product_intake_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.setup_status = 'complete' and new.setup_status <> 'complete' then
    raise integrity_constraint_violation using message = 'Un producto comercial no puede volver al intake técnico';
  end if;
  if old.setup_status <> 'complete' and new.setup_status = 'complete'
    and current_setting('columpio.complete_product_setup', true) is distinct from 'on'
  then raise insufficient_privilege using message = 'Usa save_catalog_product para completar el intake'; end if;
  if not old.technical_slug_releasable and new.technical_slug_releasable then
    raise integrity_constraint_violation using message = 'La liberación del slug técnico no puede reactivarse';
  end if;
  if new.setup_status = 'complete' then new.setup_expires_at := null; end if;
  return new;
end;
$$;
revoke all on function public.protect_product_intake_state() from public, anon, authenticated;

create trigger products_protect_intake_state
before update of setup_status, technical_slug_releasable on public.products
for each row execute function public.protect_product_intake_state();

create or replace function public.protect_product_analysis_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.analysis_status is not distinct from old.analysis_status then return new; end if;
  if not (
    (old.analysis_status = 'not_started' and new.analysis_status = 'processing')
    or (old.analysis_status = 'processing' and new.analysis_status in ('completed', 'failed'))
    or (old.analysis_status = 'failed' and new.analysis_status = 'processing')
  ) then raise integrity_constraint_violation using message = 'Transición de análisis no permitida'; end if;
  return new;
end;
$$;
revoke all on function public.protect_product_analysis_transition() from public, anon, authenticated;

create trigger products_protect_analysis_transition
before update of analysis_status on public.products
for each row execute function public.protect_product_analysis_transition();

-- El primer slug comercial de un draft técnico reemplaza la reserva interna
-- sin crear historia. Esta excepción no aplica a productos ready/published.
create or replace function public.change_product_slug_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_registry public.product_slug_registry%rowtype;
  discard_internal_slug boolean := false;
begin
  if new.slug is not distinct from old.slug and new.brand_id is not distinct from old.brand_id then
    return new;
  end if;
  if new.slug is null or new.brand_id is null then
    raise not_null_violation using message = 'Marca y slug son obligatorios';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.id::text, 0));
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
  if old.technical_slug_releasable
    and (new.slug ~ '^draft-[0-9a-f]{32}$' or new.sku ~ '^DRAFT-')
  then raise check_violation using message = 'Define SKU y slug comerciales antes de retirar el slug técnico'; end if;

  discard_internal_slug := old.technical_slug_releasable
    and old.setup_status in ('technical_draft', 'in_progress')
    and old.publication_status = 'draft'
    and old.published_at is null
    and old.slug ~ '^draft-[0-9a-f]{32}$';

  if found and discard_internal_slug then
    delete from public.product_slug_registry where id = old_registry.id;
    new.technical_slug_releasable := false;
  elsif found then
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

create or replace function public.catalog_product_setup_is_complete(p_product_id uuid)
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
      and product.brand_id is not null
      and product.category_id is not null
      and product.sku !~ '^DRAFT-'
      and product.slug !~ '^draft-[0-9a-f]{32}$'
      and nullif(trim(product.sku), '') is not null
      and nullif(trim(product.slug), '') is not null
      and nullif(trim(product.name), '') is not null
      and nullif(trim(product.description), '') is not null
      and product.price > 0
      and exists (select 1 from public.brands brand where brand.id = product.brand_id and brand.active)
      and exists (
        select 1 from public.categories category
        where category.id = product.category_id and category.brand_id = product.brand_id and category.active
      )
      and exists (
        select 1 from public.product_variants variant
        where variant.product_id = product.id and variant.active
          and nullif(trim(variant.variant_sku), '') is not null
          and nullif(trim(variant.color), '') is not null
          and nullif(trim(variant.size), '') is not null
          and variant.stock >= 0
      )
  );
$$;
revoke all on function public.catalog_product_setup_is_complete(uuid) from public, anon;
grant execute on function public.catalog_product_setup_is_complete(uuid) to authenticated;

create or replace function public.catalog_product_is_complete(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products product
    where product.id = p_product_id
      and product.setup_status = 'complete'
      and product.active
      and public.catalog_product_setup_is_complete(product.id)
  );
$$;
revoke all on function public.catalog_product_is_complete(uuid) from public, anon;
grant execute on function public.catalog_product_is_complete(uuid) to authenticated;

create or replace function public.create_product_intake_draft()
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft_id uuid := gen_random_uuid();
  brand_id uuid;
  internal_token text := replace(draft_id::text, '-', '');
  current_user_id uuid := auth.uid();
  reusable_draft_id uuid;
begin
  if current_user_id is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id::text, 0));
  select product.id into reusable_draft_id
  from public.products product
  where product.setup_created_by = current_user_id
    and product.setup_status = 'technical_draft'
    and product.analysis_status = 'not_started'
    and product.setup_expires_at > now()
    and not exists (select 1 from public.product_images image where image.product_id = product.id)
  order by product.setup_started_at desc, product.id
  limit 1 for update;
  if reusable_draft_id is not null then return reusable_draft_id; end if;
  select id into brand_id from public.brands where code = 'COLUMPIO_MUJER' and active;
  if brand_id is null then raise no_data_found using message = 'Columpio Mujer no está disponible'; end if;

  insert into public.products (
    id, sku, name, description, category, subcategory, price, style, season,
    formality, fit, material, occasions, active, brand_id, category_id, slug,
    short_description, publication_status, published_at, seo_title, seo_description,
    setup_status, setup_started_at, setup_updated_at, setup_created_by,
    setup_expires_at, analysis_status, technical_slug_releasable
  ) values (
    draft_id, 'DRAFT-' || upper(internal_token), 'Producto en preparación',
    '', '', '', 0, '', '', '', '', '', '{}'::text[], false, brand_id, null,
    'draft-' || internal_token, '', 'draft', null, '', '', 'technical_draft',
    now(), now(), current_user_id, now() + interval '7 days', 'not_started', true
  );
  return draft_id;
end;
$$;
revoke all on function public.create_product_intake_draft() from public, anon;
grant execute on function public.create_product_intake_draft() to authenticated;

create or replace function public.begin_product_intake_analysis(p_product_id uuid, p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.products product set analysis_status = 'processing', analysis_error = null,
    setup_expires_at = now() + interval '7 days'
  where product.id = p_product_id
    and product.setup_status in ('technical_draft', 'in_progress')
    and product.publication_status = 'draft' and not product.active
    and (
      product.analysis_status in ('not_started', 'failed')
      or (product.analysis_status = 'processing' and product.setup_updated_at < now() - interval '5 minutes')
    )
    and exists (
      select 1 from public.product_images image
      where image.product_id = product.id and image.id = p_image_id
        and image.status = 'ready' and image.storage_bucket = 'product-images'
        and image.storage_path like product.id::text || '/%'
    );
  if not found then raise check_violation using message = 'Draft, imagen o estado de análisis no válidos'; end if;
end;
$$;
revoke all on function public.begin_product_intake_analysis(uuid, uuid) from public, anon;
grant execute on function public.begin_product_intake_analysis(uuid, uuid) to authenticated;

create or replace function public.complete_product_intake_analysis(p_product_id uuid, p_model text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.products set analysis_status = 'completed', analysis_completed_at = now(),
    analysis_model = left(trim(p_model), 100), analysis_error = null,
    setup_status = 'in_progress', setup_expires_at = now() + interval '7 days'
  where id = p_product_id and analysis_status = 'processing'
    and setup_status in ('technical_draft', 'in_progress');
  if not found then raise check_violation using message = 'El análisis no está en progreso'; end if;
end;
$$;
revoke all on function public.complete_product_intake_analysis(uuid, text) from public, anon;
grant execute on function public.complete_product_intake_analysis(uuid, text) to authenticated;

create or replace function public.fail_product_intake_analysis(p_product_id uuid, p_error text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.products set analysis_status = 'failed', analysis_completed_at = null,
    analysis_error = left(coalesce(nullif(trim(p_error), ''), 'No se pudo analizar la imagen'), 500),
    setup_expires_at = now() + interval '7 days'
  where id = p_product_id and setup_status in ('technical_draft', 'in_progress');
  if not found then raise check_violation using message = 'Draft no disponible'; end if;
end;
$$;
revoke all on function public.fail_product_intake_analysis(uuid, text) from public, anon;
grant execute on function public.fail_product_intake_analysis(uuid, text) to authenticated;

-- Mantiene la firma pública y todo el comportamiento legacy de variantes e imágenes.
alter function public.save_catalog_product(jsonb, jsonb, jsonb) rename to save_catalog_product_legacy_016;
revoke all on function public.save_catalog_product_legacy_016(jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.save_catalog_product(p_product jsonb, p_variants jsonb, p_images jsonb default '[]'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  product_id uuid := nullif(p_product->>'id', '')::uuid;
  prior_setup_status text;
  requested_status text := coalesce(nullif(p_product->>'publication_status', ''), 'draft');
  requested_active boolean := coalesce((p_product->>'active')::boolean, false);
  safe_product jsonb := p_product;
  saved_id uuid;
  item jsonb;
begin
  if product_id is not null then
    select setup_status into prior_setup_status from public.products where id = product_id for update;
  end if;
  if prior_setup_status in ('technical_draft', 'in_progress') and requested_status = 'ready' then
    safe_product := jsonb_set(safe_product, '{publication_status}', '"draft"'::jsonb, true);
  end if;
  if prior_setup_status in ('technical_draft', 'in_progress') then
    safe_product := jsonb_set(safe_product, '{active}', 'false'::jsonb, true);
    for item in select * from jsonb_array_elements(coalesce(p_variants, '[]'::jsonb)) loop
      if nullif(trim(item->>'variant_sku'), '') is null
        or nullif(trim(item->>'color'), '') is null
        or nullif(trim(item->>'size'), '') is null
        or nullif(item->>'stock', '') is null
        or (item->>'stock')::integer < 0
      then raise check_violation using message = 'Completa SKU, color, talla y stock de cada variante antes de guardar'; end if;
    end loop;
  end if;
  if prior_setup_status = 'technical_draft' then
    -- Evita que el constraint del placeholder técnico bloquee la actualización
    -- comercial intermedia; cualquier error posterior revierte toda la transacción.
    update public.products set setup_status = 'in_progress' where id = product_id;
  end if;

  saved_id := public.save_catalog_product_legacy_016(safe_product, p_variants, p_images);

  if prior_setup_status in ('technical_draft', 'in_progress') then
    if public.catalog_product_setup_is_complete(saved_id) then
      perform pg_catalog.set_config('columpio.complete_product_setup', 'on', true);
      update public.products set setup_status = 'complete', active = requested_active, setup_expires_at = null where id = saved_id;
      if requested_status = 'ready' and requested_active then
        update public.products set publication_status = 'ready', published_at = null where id = saved_id;
      end if;
    else
      update public.products set setup_status = 'in_progress', active = false, publication_status = 'draft',
        published_at = null, setup_expires_at = now() + interval '7 days' where id = saved_id;
    end if;
  end if;
  return saved_id;
end;
$$;
revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.publish_catalog_product(p_product_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare current_status text; current_setup text;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  select publication_status, setup_status into current_status, current_setup
  from public.products where id = p_product_id for update;
  if not found then raise no_data_found using message = 'Producto no encontrado'; end if;
  if current_setup <> 'complete' then raise check_violation using message = 'Completa la ficha comercial antes de publicar'; end if;
  if current_status = 'published' then
    if not public.catalog_product_is_complete(p_product_id) then raise check_violation using message = 'El producto publicado dejó de estar completo'; end if;
    return;
  end if;
  if current_status <> 'ready' then raise check_violation using message = 'Solo un producto listo puede publicarse'; end if;
  if not public.catalog_product_is_complete(p_product_id) then raise check_violation using message = 'El producto no cumple los requisitos editoriales'; end if;
  update public.products set publication_status = 'published', published_at = now() where id = p_product_id;
end;
$$;
revoke all on function public.publish_catalog_product(uuid) from public, anon;
grant execute on function public.publish_catalog_product(uuid) to authenticated;

commit;
