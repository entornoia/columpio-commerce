begin;

-- Bloque Web 3A. authenticated representa administración hasta incorporar roles.
-- Antes de admitir clientes autenticados se debe reemplazar este contrato por autorización administrativa explícita.
alter table public.product_images
  add column storage_bucket text,
  add column storage_path text,
  add column mime_type text,
  add column width integer,
  add column height integer,
  add column file_size bigint,
  add column status text not null default 'ready',
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

alter table public.product_images
  add constraint product_images_status_check check (status in ('pending', 'ready', 'delete_pending', 'failed')),
  add constraint product_images_storage_pair_check check ((storage_bucket is null) = (storage_path is null)),
  add constraint product_images_storage_bucket_check check (storage_bucket is null or storage_bucket = 'product-images'),
  add constraint product_images_mime_check check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  add constraint product_images_width_check check (width is null or width > 0),
  add constraint product_images_height_check check (height is null or height > 0),
  add constraint product_images_file_size_check check (file_size is null or file_size between 1 and 5242880),
  add constraint product_images_ready_storage_check check (
    storage_path is null or status <> 'ready' or (mime_type is not null and file_size is not null and image_url <> '')
  );

create unique index product_images_storage_path_idx
  on public.product_images(storage_bucket, storage_path)
  where storage_path is not null;

create or replace function public.set_product_image_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_product_image_updated_at() from public, anon, authenticated;

create trigger product_images_updated_at before update on public.product_images
for each row execute function public.set_product_image_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads product images" on storage.objects;
drop policy if exists "Authenticated reads registered product images" on storage.objects;
create policy "Authenticated reads registered product images" on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.product_images image
    where image.storage_bucket = bucket_id and image.storage_path = name
  )
);

drop policy if exists "Authenticated uploads reserved product images" on storage.objects;
create policy "Authenticated uploads reserved product images" on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
  and exists (
    select 1 from public.product_images image
    where image.storage_bucket = bucket_id and image.storage_path = name and image.status = 'pending'
  )
);

drop policy if exists "Authenticated deletes pending product images" on storage.objects;
create policy "Authenticated deletes pending product images" on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.product_images image
    where image.storage_bucket = bucket_id
      and image.storage_path = name
      and image.status in ('delete_pending', 'pending', 'failed')
  )
);

-- No se crea policy UPDATE: los reemplazos siempre usan un nuevo image_id y path.

create or replace function public.reserve_product_image_upload(
  p_product_id uuid, p_image_id uuid, p_extension text, p_image_url text,
  p_mime_type text, p_file_size bigint, p_width integer default null,
  p_height integer default null, p_alt_text text default ''
)
returns table (image_id uuid, storage_path text, image_position integer)
language plpgsql security invoker set search_path = '' as $$
declare
  normalized_extension text := lower(trim(leading '.' from p_extension));
  desired_path text;
  desired_position integer;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  if not exists (select 1 from public.products product where product.id = p_product_id) then
    raise no_data_found using message = 'Producto no encontrado';
  end if;
  if not ((p_mime_type = 'image/jpeg' and normalized_extension in ('jpg', 'jpeg'))
    or (p_mime_type = 'image/png' and normalized_extension = 'png')
    or (p_mime_type = 'image/webp' and normalized_extension = 'webp')) then
    raise check_violation using message = 'Formato de imagen no permitido';
  end if;
  if p_file_size is null or p_file_size < 1 or p_file_size > 5242880 then
    raise check_violation using message = 'La imagen debe pesar como máximo 5 MiB';
  end if;
  if p_width is not null and p_width <= 0 or p_height is not null and p_height <= 0 then
    raise check_violation using message = 'Dimensiones de imagen inválidas';
  end if;
  desired_path := p_product_id::text || '/' || p_image_id::text || '.' || normalized_extension;
  if p_image_url is null or p_image_url = '' or position('/product-images/' || desired_path in p_image_url) = 0 then
    raise check_violation using message = 'URL pública inconsistente con el path reservado';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));
  select coalesce(max(image.position), -1) + 1 into desired_position
  from public.product_images image where image.product_id = p_product_id;
  insert into public.product_images (
    id, product_id, image_url, position, alt_text, storage_bucket, storage_path,
    mime_type, width, height, file_size, status
  ) values (
    p_image_id, p_product_id, trim(p_image_url), desired_position, coalesce(trim(p_alt_text), ''),
    'product-images', desired_path, p_mime_type, p_width, p_height, p_file_size, 'pending'
  );
  return query select p_image_id, desired_path, desired_position;
end;
$$;
revoke all on function public.reserve_product_image_upload(uuid, uuid, text, text, text, bigint, integer, integer, text) from public, anon;
grant execute on function public.reserve_product_image_upload(uuid, uuid, text, text, text, bigint, integer, integer, text) to authenticated;

create or replace function public.finalize_product_image_upload(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.product_images set status = 'ready' where id = p_image_id and status = 'pending';
  if not found and not exists (select 1 from public.product_images where id = p_image_id and status = 'ready') then
    raise check_violation using message = 'La imagen no está pendiente de finalización';
  end if;
end;
$$;
revoke all on function public.finalize_product_image_upload(uuid) from public, anon;
grant execute on function public.finalize_product_image_upload(uuid) to authenticated;

create or replace function public.fail_product_image_upload(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.product_images set status = 'failed' where id = p_image_id and status = 'pending';
  if not found and not exists (select 1 from public.product_images where id = p_image_id and status = 'failed') then
    raise check_violation using message = 'La imagen no puede marcarse como fallida';
  end if;
end;
$$;
revoke all on function public.fail_product_image_upload(uuid) from public, anon;
grant execute on function public.fail_product_image_upload(uuid) to authenticated;

create or replace function public.cancel_product_image_upload(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  delete from public.product_images where id = p_image_id and status in ('pending', 'failed');
  if not found then raise check_violation using message = 'La carga no puede cancelarse'; end if;
end;
$$;
revoke all on function public.cancel_product_image_upload(uuid) from public, anon;
grant execute on function public.cancel_product_image_upload(uuid) to authenticated;

create or replace function public.begin_product_image_deletion(p_image_id uuid)
returns table (storage_bucket text, storage_path text)
language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.product_images set status = 'delete_pending' where id = p_image_id and status = 'ready';
  if not found then raise check_violation using message = 'La imagen no está disponible para eliminación'; end if;
  return query select image.storage_bucket, image.storage_path from public.product_images image where image.id = p_image_id;
end;
$$;
revoke all on function public.begin_product_image_deletion(uuid) from public, anon;
grant execute on function public.begin_product_image_deletion(uuid) to authenticated;

create or replace function public.cancel_product_image_deletion(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.product_images set status = 'ready' where id = p_image_id and status = 'delete_pending';
  if not found and not exists (select 1 from public.product_images where id = p_image_id and status = 'ready') then
    raise check_violation using message = 'La eliminación no puede cancelarse';
  end if;
end;
$$;
revoke all on function public.cancel_product_image_deletion(uuid) from public, anon;
grant execute on function public.cancel_product_image_deletion(uuid) to authenticated;

create or replace function public.finalize_product_image_deletion(p_image_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_product_id uuid; move_offset integer;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  select product_id into target_product_id from public.product_images where id = p_image_id and status = 'delete_pending' for update;
  if not found then raise check_violation using message = 'La imagen no está pendiente de eliminación'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_product_id::text, 0));
  delete from public.product_images where id = p_image_id;
  select coalesce(max(position), 0) + count(*)::integer + 1 into move_offset
  from public.product_images where product_id = target_product_id;
  update public.product_images set position = position + move_offset where product_id = target_product_id;
  with ordered as (
    select id, row_number() over (
      order by case when status = 'ready' then 0 else 1 end, position, id
    ) - 1 as next_position
    from public.product_images where product_id = target_product_id
  )
  update public.product_images image set position = ordered.next_position
  from ordered where image.id = ordered.id;
end;
$$;
revoke all on function public.finalize_product_image_deletion(uuid) from public, anon;
grant execute on function public.finalize_product_image_deletion(uuid) to authenticated;

create or replace function public.reorder_product_images(p_product_id uuid, p_image_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare ready_count integer; input_count integer; supplied_count integer; move_offset integer;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));
  select count(*) into ready_count from public.product_images where product_id = p_product_id and status = 'ready';
  input_count := pg_catalog.cardinality(coalesce(p_image_ids, '{}'::uuid[]));
  select count(distinct supplied.image_id) into supplied_count
  from unnest(coalesce(p_image_ids, '{}'::uuid[])) as supplied(image_id);
  if ready_count <> input_count or supplied_count <> input_count or exists (
    select 1 from unnest(coalesce(p_image_ids, '{}'::uuid[])) as supplied(image_id)
    where not exists (
      select 1 from public.product_images image
      where image.id = supplied.image_id and image.product_id = p_product_id and image.status = 'ready'
    )
  ) then raise check_violation using message = 'El orden debe incluir exactamente todas las imágenes listas del producto'; end if;
  select coalesce(max(position), 0) + count(*)::integer + 1 into move_offset
  from public.product_images where product_id = p_product_id;
  update public.product_images set position = position + move_offset where product_id = p_product_id;
  with desired as (
    select item.image_id, item.ordinal - 1 as next_position
    from unnest(p_image_ids) with ordinality as item(image_id, ordinal)
  )
  update public.product_images image set position = desired.next_position from desired where image.id = desired.image_id;
  with remaining as (
    select id, ready_count + row_number() over (order by position) - 1 as next_position
    from public.product_images where product_id = p_product_id and status <> 'ready'
  ) update public.product_images image set position = remaining.next_position from remaining where image.id = remaining.id;
end;
$$;
revoke all on function public.reorder_product_images(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_product_images(uuid, uuid[]) to authenticated;

create or replace function public.update_product_image_alt(p_image_id uuid, p_alt_text text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  update public.product_images set alt_text = coalesce(trim(p_alt_text), '') where id = p_image_id and status = 'ready';
  if not found then raise no_data_found using message = 'Imagen no encontrada'; end if;
end;
$$;
revoke all on function public.update_product_image_alt(uuid, text) from public, anon;
grant execute on function public.update_product_image_alt(uuid, text) to authenticated;

-- Conserva la firma pública sin borrar ni reconstruir filas Storage.
-- El trigger solo preserva filas Storage cuando el wrapper activa el guard transaccional.
-- Las RPC específicas de eliminación no activan el guard y eliminan normalmente.
create or replace function public.protect_storage_images_during_catalog_save()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.storage_path is not null
    and current_setting('columpio.preserve_storage_images', true) = 'on' then
    return null;
  end if;
  return old;
end;
$$;
revoke all on function public.protect_storage_images_during_catalog_save() from public, anon, authenticated;

create trigger product_images_preserve_storage_during_catalog_save
before delete on public.product_images
for each row execute function public.protect_storage_images_during_catalog_save();

alter function public.save_catalog_product(jsonb, jsonb, jsonb) rename to save_catalog_product_legacy_015;
revoke all on function public.save_catalog_product_legacy_015(jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.save_catalog_product(p_product jsonb, p_variants jsonb, p_images jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  saved_id uuid := coalesce(nullif(p_product->>'id', '')::uuid, gen_random_uuid());
  legacy_images jsonb;
  result_id uuid;
  storage_max_position integer;
  previous_guard text;
begin
  if (select auth.uid()) is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  select max(image.position) into storage_max_position
  from public.product_images image
  where image.product_id = saved_id and image.storage_path is not null;
  if storage_max_position is null then
    legacy_images := coalesce(p_images, '[]'::jsonb);
  else
    with requested as (
      select item.value,
        row_number() over (
          order by coalesce(nullif(item.value->>'position', '')::integer, item.ordinal::integer), item.ordinal
        ) as normalized_ordinal
      from jsonb_array_elements(coalesce(p_images, '[]'::jsonb))
      with ordinality as item(value, ordinal)
      where not exists (
        select 1 from public.product_images storage_image
        where storage_image.product_id = saved_id
          and storage_image.storage_path is not null
          and storage_image.id::text = item.value->>'id'
      )
    )
    select coalesce(jsonb_agg(
      requested.value || jsonb_build_object('position', storage_max_position + requested.normalized_ordinal)
      order by requested.normalized_ordinal
    ), '[]'::jsonb) into legacy_images from requested;
  end if;
  previous_guard := current_setting('columpio.preserve_storage_images', true);
  perform set_config('columpio.preserve_storage_images', 'on', true);
  result_id := public.save_catalog_product_legacy_015(p_product, p_variants, legacy_images);
  perform set_config('columpio.preserve_storage_images', coalesce(previous_guard, 'off'), true);
  return result_id;
end;
$$;
revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;

create or replace function public.list_public_products(p_category_slug text default null, p_limit integer default 24)
returns table (
  id uuid, brand_slug text, category_slug text, category_name text, slug text,
  name text, short_description text, description text, price numeric, style text,
  material text, is_available boolean, colors jsonb, sizes jsonb, images jsonb, published_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select product.id, brand.slug, category.slug, category.name, product.slug,
    product.name, product.short_description, product.description, product.price, product.style, product.material,
    exists (select 1 from public.product_variants available_variant where available_variant.product_id = product.id and available_variant.active and available_variant.stock > 0),
    coalesce((select jsonb_agg(distinct variant.color) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(distinct variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id and image.status = 'ready'), '[]'::jsonb),
    product.published_at
  from public.products product join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active and product.publication_status = 'published'
    and (p_category_slug is null or category.slug = public.catalog_slugify(p_category_slug))
  order by product.published_at desc, product.name limit greatest(0, least(coalesce(p_limit, 24), 100));
$$;
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
    exists (select 1 from public.product_variants available_variant where available_variant.product_id = product.id and available_variant.active and available_variant.stock > 0),
    coalesce((select jsonb_agg(jsonb_build_object('color', variant.color, 'size', variant.size, 'available', (variant.stock > 0)) order by variant.color, variant.size) from public.product_variants variant where variant.product_id = product.id and variant.active), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('url', image.image_url, 'alt', image.alt_text, 'position', image.position) order by image.position) from public.product_images image where image.product_id = product.id and image.status = 'ready'), '[]'::jsonb),
    product.seo_title, product.seo_description, product.published_at
  from public.products product join public.brands brand on brand.id = product.brand_id and brand.active
  join public.categories category on category.id = product.category_id and category.active
  where product.active and product.publication_status = 'published'
    and product.slug = public.catalog_slugify(p_slug) and brand.slug = public.catalog_slugify(p_brand_slug)
  limit 1;
$$;
revoke all on function public.get_public_product_by_slug(text, text) from public, anon, authenticated;
grant execute on function public.get_public_product_by_slug(text, text) to anon, authenticated;

commit;
