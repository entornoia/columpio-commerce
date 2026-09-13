begin;

-- Tombstone privado para que la saga sea reintentable sin conservar el producto.
create table public.product_draft_deletions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique,
  product_sku text not null,
  status text not null check (status in ('prepared', 'storage_failed', 'completed')),
  storage_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(storage_manifest) = 'array'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger product_draft_deletions_updated_at
before update on public.product_draft_deletions
for each row execute function public.set_updated_at();

alter table public.product_draft_deletions enable row level security;
revoke all on table public.product_draft_deletions from public, anon, authenticated;
grant select, insert, update on table public.product_draft_deletions to service_role;

create or replace function public.technical_draft_deletion_snapshot(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_product public.products%rowtype;
  blockers jsonb := '[]'::jsonb;
  reference_counts jsonb;
  variant_count integer;
  total_stock bigint;
  image_count integer;
  storage_image_count integer;
  unregistered_storage_count integer;
  slug_registry_count integer;
  slug_history_count integer;
  legacy_cart_count integer;
  legacy_order_count integer;
  legacy_payment_count integer;
  legacy_flow_count integer;
  legacy_operation_count integer;
  instagram_count integer;
  web_cart_count integer;
  web_order_count integer;
  web_payment_count integer;
  reservation_count integer;
  movement_count integer;
  promotion_count integer;
  invalid_storage_count integer;
begin
  select product.* into selected_product
  from public.products product
  where product.id = p_product_id;

  if not found then
    return jsonb_build_object('eligible', false, 'exists', false, 'blockers', jsonb_build_array('product_not_found'));
  end if;

  select count(*), coalesce(sum(variant.stock), 0)
  into variant_count, total_stock
  from public.product_variants variant
  where variant.product_id = p_product_id;

  select count(*), count(*) filter (where image.storage_path is not null),
    count(*) filter (
      where image.storage_path is not null and (
        image.storage_bucket is distinct from 'product-images'
        or image.storage_path !~ ('^' || p_product_id::text || '/' || image.id::text || '\\.(jpg|jpeg|png|webp)$')
      )
    )
  into image_count, storage_image_count, invalid_storage_count
  from public.product_images image
  where image.product_id = p_product_id;

  select count(*) into unregistered_storage_count
  from storage.objects object
  where object.bucket_id = 'product-images'
    and object.name like p_product_id::text || '/%'
    and not exists (
      select 1 from public.product_images image
      where image.product_id = p_product_id
        and image.storage_bucket = object.bucket_id
        and image.storage_path = object.name
    );

  select count(*) into slug_registry_count
  from public.product_slug_registry registry
  where registry.product_id = p_product_id
    and registry.is_current
    and registry.brand_id = selected_product.brand_id
    and registry.slug = selected_product.slug;

  select count(*) into slug_history_count
  from public.product_slug_history history
  where history.product_id = p_product_id;

  select count(*) into legacy_cart_count
  from public.commerce_cart_items item
  where item.product_id = p_product_id
    or item.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(*) into legacy_order_count
  from public.commerce_order_items item
  where item.product_id = p_product_id
    or item.product_sku = selected_product.sku
    or item.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(distinct preference.id) into legacy_payment_count
  from public.commerce_payment_preferences preference
  join public.commerce_order_items item on item.order_id = preference.order_id
  where item.product_id = p_product_id or item.product_sku = selected_product.sku;

  select count(distinct checkout.id) into legacy_flow_count
  from public.commerce_flow_checkouts checkout
  join public.commerce_order_items item on item.order_id = checkout.order_id
  where item.product_id = p_product_id or item.product_sku = selected_product.sku;

  select count(*) into legacy_operation_count
  from public.commerce_operations operation
  where operation.result::text like '%' || p_product_id::text || '%'
     or operation.result::text like '%' || selected_product.sku || '%';

  select count(*) into instagram_count
  from public.instagram_conversations conversation
  where conversation.last_product_id = p_product_id
     or conversation.focus_product_id = p_product_id
     or conversation.last_variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id)
     or conversation.focus_variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(*) into web_cart_count
  from public.web_cart_items item
  where item.product_id = p_product_id
    or item.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(*) into web_order_count
  from public.web_order_items item
  where item.product_id = p_product_id
    or item.product_sku = selected_product.sku
    or item.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(distinct payment.id) into web_payment_count
  from public.web_payments payment
  join public.web_order_items item on item.order_id = payment.order_id
  where item.product_id = p_product_id or item.product_sku = selected_product.sku;

  select count(*) into reservation_count
  from public.web_stock_reservation_items item
  where item.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(*) into movement_count
  from public.inventory_movements movement
  where movement.variant_id in (select variant.id from public.product_variants variant where variant.product_id = p_product_id);

  select count(*) into promotion_count
  from public.web_promotion_targets target
  where target.product_id = p_product_id;

  if selected_product.setup_status <> 'technical_draft' then blockers := blockers || '"not_technical_draft"'::jsonb; end if;
  if selected_product.sku !~ '^DRAFT-[0-9A-F]{32}$' then blockers := blockers || '"sku_not_technical"'::jsonb; end if;
  if selected_product.publication_status <> 'draft' then blockers := blockers || '"publication_not_draft"'::jsonb; end if;
  if selected_product.active then blockers := blockers || '"product_active"'::jsonb; end if;
  if selected_product.published_at is not null then blockers := blockers || '"product_was_published"'::jsonb; end if;
  if not selected_product.technical_slug_releasable then blockers := blockers || '"slug_not_releasable"'::jsonb; end if;
  if selected_product.slug !~ ('^draft-' || replace(lower(p_product_id::text), '-', '') || '$') then blockers := blockers || '"slug_not_technical"'::jsonb; end if;
  if total_stock <> 0 then blockers := blockers || '"stock_not_zero"'::jsonb; end if;
  if slug_registry_count <> 1 then blockers := blockers || '"invalid_slug_registry"'::jsonb; end if;
  if slug_history_count <> 0 then blockers := blockers || '"slug_history_exists"'::jsonb; end if;
  if invalid_storage_count <> 0 then blockers := blockers || '"invalid_storage_metadata"'::jsonb; end if;
  if unregistered_storage_count <> 0 then blockers := blockers || '"unregistered_storage_objects"'::jsonb; end if;
  if legacy_cart_count + legacy_order_count + legacy_payment_count + legacy_flow_count + legacy_operation_count
    + instagram_count + web_cart_count + web_order_count + web_payment_count + reservation_count
    + movement_count + promotion_count <> 0
  then blockers := blockers || '"historical_or_transactional_references"'::jsonb; end if;

  reference_counts := jsonb_build_object(
    'legacyCartItems', legacy_cart_count,
    'legacyOrderItems', legacy_order_count,
    'legacyPayments', legacy_payment_count,
    'legacyFlowCheckouts', legacy_flow_count,
    'legacyOperations', legacy_operation_count,
    'instagramConversations', instagram_count,
    'webCartItems', web_cart_count,
    'webOrderItems', web_order_count,
    'webPayments', web_payment_count,
    'reservations', reservation_count,
    'inventoryMovements', movement_count,
    'promotionTargets', promotion_count,
    'slugHistory', slug_history_count
  );

  return jsonb_build_object(
    'eligible', jsonb_array_length(blockers) = 0,
    'exists', true,
    'productId', selected_product.id,
    'sku', selected_product.sku,
    'variantCount', variant_count,
    'totalStock', total_stock,
    'imageCount', image_count,
    'storageImageCount', storage_image_count,
    'blockers', blockers,
    'references', reference_counts
  );
end;
$$;

alter function public.technical_draft_deletion_snapshot(uuid) owner to postgres;
revoke all on function public.technical_draft_deletion_snapshot(uuid) from public, anon, authenticated;

create or replace function public.get_technical_draft_deletion_eligibility(p_product_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.technical_draft_deletion_snapshot(p_product_id);
$$;

alter function public.get_technical_draft_deletion_eligibility(uuid) owner to postgres;
revoke all on function public.get_technical_draft_deletion_eligibility(uuid) from public, anon, authenticated;
grant execute on function public.get_technical_draft_deletion_eligibility(uuid) to service_role;

create or replace function public.begin_technical_draft_deletion(p_product_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_product public.products%rowtype;
  existing_job public.product_draft_deletions%rowtype;
  eligibility jsonb;
  manifest jsonb;
  job_id uuid;
begin
  if p_actor_user_id is null or not exists (select 1 from auth.users user_account where user_account.id = p_actor_user_id) then
    raise insufficient_privilege using message = 'Administrative actor required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));
  select deletion.* into existing_job
  from public.product_draft_deletions deletion
  where deletion.product_id = p_product_id
  for update;

  if found and existing_job.status = 'completed' then
    return jsonb_build_object('operationId', existing_job.id, 'status', 'completed', 'storage', existing_job.storage_manifest);
  end if;

  select product.* into selected_product
  from public.products product
  where product.id = p_product_id
  for update;
  if not found then raise no_data_found using message = 'Technical draft not found'; end if;

  eligibility := public.technical_draft_deletion_snapshot(p_product_id);
  if not coalesce((eligibility->>'eligible')::boolean, false) then
    raise check_violation using message = 'Technical draft is not eligible for deletion';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'imageId', image.id,
    'bucket', image.storage_bucket,
    'path', image.storage_path
  ) order by image.position, image.id), '[]'::jsonb)
  into manifest
  from public.product_images image
  where image.product_id = p_product_id and image.storage_path is not null;

  update public.product_images image
  set status = 'delete_pending'
  where image.product_id = p_product_id and image.storage_path is not null and image.status <> 'delete_pending';

  insert into public.product_draft_deletions(product_id, product_sku, status, storage_manifest, actor_user_id)
  values(p_product_id, selected_product.sku, 'prepared', manifest, p_actor_user_id)
  on conflict(product_id) do update set
    status = 'prepared', storage_manifest = excluded.storage_manifest,
    actor_user_id = excluded.actor_user_id, completed_at = null
  returning id into job_id;

  return jsonb_build_object('operationId', job_id, 'status', 'prepared', 'storage', manifest);
end;
$$;

alter function public.begin_technical_draft_deletion(uuid, uuid) owner to postgres;
revoke all on function public.begin_technical_draft_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_technical_draft_deletion(uuid, uuid) to service_role;

create or replace function public.fail_technical_draft_storage_deletion(p_product_id uuid, p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.product_draft_deletions deletion
  set status = 'storage_failed'
  where deletion.id = p_operation_id and deletion.product_id = p_product_id and deletion.status = 'prepared';
  if not found and not exists (
    select 1 from public.product_draft_deletions deletion
    where deletion.id = p_operation_id and deletion.product_id = p_product_id and deletion.status = 'storage_failed'
  ) then raise check_violation using message = 'Draft deletion operation is not prepared'; end if;
end;
$$;

alter function public.fail_technical_draft_storage_deletion(uuid, uuid) owner to postgres;
revoke all on function public.fail_technical_draft_storage_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_technical_draft_storage_deletion(uuid, uuid) to service_role;

create or replace function public.finalize_technical_draft_deletion(p_product_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_product public.products%rowtype;
  selected_job public.product_draft_deletions%rowtype;
  eligibility jsonb;
  removed_registry integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));
  select deletion.* into selected_job
  from public.product_draft_deletions deletion
  where deletion.id = p_operation_id and deletion.product_id = p_product_id
  for update;
  if not found then raise no_data_found using message = 'Draft deletion operation not found'; end if;
  if selected_job.status = 'completed' then
    return jsonb_build_object('deleted', true, 'idempotent', true, 'productId', p_product_id);
  end if;
  if selected_job.status not in ('prepared', 'storage_failed') then
    raise check_violation using message = 'Draft deletion operation is not ready';
  end if;

  select product.* into selected_product
  from public.products product
  where product.id = p_product_id
  for update;
  if not found then raise no_data_found using message = 'Technical draft not found'; end if;

  eligibility := public.technical_draft_deletion_snapshot(p_product_id);
  if not coalesce((eligibility->>'eligible')::boolean, false) then
    raise serialization_failure using message = 'Technical draft eligibility changed';
  end if;
  if exists (
    select 1 from public.product_images image
    where image.product_id = p_product_id and image.storage_path is not null and image.status <> 'delete_pending'
  ) then raise check_violation using message = 'Storage images are not prepared for deletion'; end if;

  delete from public.product_images image where image.product_id = p_product_id;
  delete from public.product_slug_registry registry
  where registry.product_id = p_product_id
    and registry.is_current
    and registry.brand_id = selected_product.brand_id
    and registry.slug = selected_product.slug;
  get diagnostics removed_registry = row_count;
  if removed_registry <> 1 then raise integrity_constraint_violation using message = 'Technical slug registry was not removed exactly once'; end if;

  delete from public.products product where product.id = p_product_id;
  if not found then raise serialization_failure using message = 'Technical draft changed during deletion'; end if;

  update public.product_draft_deletions deletion
  set status = 'completed', completed_at = now()
  where deletion.id = p_operation_id;

  return jsonb_build_object('deleted', true, 'idempotent', false, 'productId', p_product_id);
end;
$$;

alter function public.finalize_technical_draft_deletion(uuid, uuid) owner to postgres;
revoke all on function public.finalize_technical_draft_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_technical_draft_deletion(uuid, uuid) to service_role;

comment on table public.product_draft_deletions is
  'Tombstone privado de la saga de eliminación física, reservado exclusivamente para technical_draft huérfanos.';
comment on function public.get_technical_draft_deletion_eligibility(uuid) is
  'Evaluación read-only. Un publication_status draft no basta: exige setup_status technical_draft, SKU/slug técnicos y cero historia.';
comment on function public.finalize_technical_draft_deletion(uuid, uuid) is
  'Excepción estrecha a la política no-DELETE: solo technical_draft huérfanos, tras retirar Storage y revalidar bajo lock.';

commit;
