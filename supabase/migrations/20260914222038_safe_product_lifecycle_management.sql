begin;

-- Historical evidence of the first publication is immutable. published_at keeps
-- its existing meaning (the current publication), while first_published_at
-- survives deactivation, archival and later editorial review.
alter table public.products
  add column first_published_at timestamptz;

update public.products
set first_published_at = published_at
where published_at is not null;

create or replace function public.protect_product_first_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.first_published_at is not null
    and new.first_published_at is distinct from old.first_published_at
  then
    raise check_violation using message = 'first_published_at is immutable';
  end if;

  if new.publication_status = 'published' and new.first_published_at is null then
    new.first_published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;
alter function public.protect_product_first_publication() owner to postgres;
revoke all on function public.protect_product_first_publication() from public, anon, authenticated;

create trigger products_first_publication_guard
before insert or update of publication_status, published_at, first_published_at on public.products
for each row execute function public.protect_product_first_publication();

-- The existing tombstone remains the single ledger for safe product deletion.
-- Its old technical-draft RPCs remain available for backwards compatibility.
alter table public.product_draft_deletions
  add column last_error_code text;

alter table public.product_draft_deletions
  drop constraint product_draft_deletions_status_check;
alter table public.product_draft_deletions
  add constraint product_draft_deletions_status_check
  check (status in ('prepared','storage_failed','finalize_blocked','completed'));
alter table public.product_draft_deletions
  add constraint product_draft_deletions_last_error_code_check
  check (last_error_code is null or char_length(last_error_code) between 1 and 100);

create or replace function public.safe_product_deletion_snapshot(p_product_id uuid)
returns jsonb
language plpgsql
stable
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
  invalid_storage_count integer;
  missing_storage_count integer;
  unregistered_storage_count integer;
  slug_registry_count integer;
  exact_slug_registry_count integer;
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
  fulfillment_event_count integer;
  email_event_count integer;
  unresolved_fk_count integer;
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

  select count(*),
    count(*) filter (where image.storage_path is not null),
    count(*) filter (
      where image.storage_path is not null and (
        image.storage_bucket is distinct from 'product-images'
        or image.storage_path !~ ('^' || p_product_id::text || '/' || image.id::text || '\.(jpg|jpeg|png|webp)$')
      )
    ),
    count(*) filter (
      where image.storage_path is not null and image.status <> 'delete_pending' and not exists (
        select 1 from storage.objects object
        where object.bucket_id = image.storage_bucket and object.name = image.storage_path
      )
    )
  into image_count, storage_image_count, invalid_storage_count, missing_storage_count
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

  select count(*), count(*) filter (
    where registry.is_current
      and registry.brand_id = selected_product.brand_id
      and registry.slug = selected_product.slug
  )
  into slug_registry_count, exact_slug_registry_count
  from public.product_slug_registry registry
  where registry.product_id = p_product_id;

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

  select count(distinct event.id) into fulfillment_event_count
  from public.web_order_admin_events event
  join public.web_order_items item on item.order_id = event.order_id
  where item.product_id = p_product_id or item.product_sku = selected_product.sku;

  select count(distinct event.id) into email_event_count
  from public.web_order_email_events event
  join public.web_order_items item on item.order_id = event.order_id
  where item.product_id = p_product_id or item.product_sku = selected_product.sku;

  -- Fail closed when a future migration introduces a new FK to products or
  -- product_variants that this snapshot does not yet know how to classify.
  select count(*) into unresolved_fk_count
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid in ('public.products'::regclass, 'public.product_variants'::regclass)
    and constraint_row.conrelid not in (
      'public.product_variants'::regclass,
      'public.product_images'::regclass,
      'public.product_slug_registry'::regclass,
      'public.product_slug_history'::regclass,
      'public.commerce_cart_items'::regclass,
      'public.commerce_order_items'::regclass,
      'public.instagram_conversations'::regclass,
      'public.web_cart_items'::regclass,
      'public.web_order_items'::regclass,
      'public.web_stock_reservation_items'::regclass,
      'public.web_promotion_targets'::regclass,
      'public.inventory_movements'::regclass
    );

  if selected_product.first_published_at is not null then blockers := blockers || '"product_was_published"'::jsonb; end if;
  if selected_product.published_at is not null then blockers := blockers || '"current_publication_exists"'::jsonb; end if;
  if selected_product.publication_status = 'published' then blockers := blockers || '"publication_is_published"'::jsonb; end if;
  if total_stock <> 0 then blockers := blockers || '"stock_not_zero"'::jsonb; end if;
  if slug_registry_count <> 1 or exact_slug_registry_count <> 1 then blockers := blockers || '"slug_not_releasable"'::jsonb; end if;
  if slug_history_count <> 0 then blockers := blockers || '"slug_history_exists"'::jsonb; end if;
  if invalid_storage_count <> 0 then blockers := blockers || '"invalid_storage_metadata"'::jsonb; end if;
  if missing_storage_count <> 0 then blockers := blockers || '"missing_storage_objects"'::jsonb; end if;
  if unregistered_storage_count <> 0 then blockers := blockers || '"unregistered_storage_objects"'::jsonb; end if;
  if unresolved_fk_count <> 0 then blockers := blockers || '"unresolved_reference_schema"'::jsonb; end if;
  if legacy_cart_count + legacy_order_count + legacy_payment_count + legacy_flow_count + legacy_operation_count
    + instagram_count + web_cart_count + web_order_count + web_payment_count + reservation_count
    + movement_count + promotion_count + fulfillment_event_count + email_event_count <> 0
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
    'fulfillmentEvents', fulfillment_event_count,
    'emailEvents', email_event_count,
    'slugHistory', slug_history_count,
    'unresolvedForeignKeys', unresolved_fk_count
  );

  return jsonb_build_object(
    'eligible', jsonb_array_length(blockers) = 0,
    'exists', true,
    'productId', selected_product.id,
    'sku', selected_product.sku,
    'active', selected_product.active,
    'publicationStatus', selected_product.publication_status,
    'setupStatus', selected_product.setup_status,
    'firstPublishedAt', selected_product.first_published_at,
    'variantCount', variant_count,
    'totalStock', total_stock,
    'imageCount', image_count,
    'storageImageCount', storage_image_count,
    'blockers', blockers,
    'references', reference_counts
  );
end;
$$;
alter function public.safe_product_deletion_snapshot(uuid) owner to postgres;
revoke all on function public.safe_product_deletion_snapshot(uuid) from public, anon, authenticated;

create or replace function public.get_product_management_eligibility(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot jsonb := public.safe_product_deletion_snapshot(p_product_id);
  selected_product public.products%rowtype;
  selected_action text;
  action_available boolean := true;
begin
  if not coalesce((snapshot->>'exists')::boolean, false) then
    return snapshot || jsonb_build_object('action', 'none', 'actionAvailable', false);
  end if;
  select product.* into selected_product from public.products product where product.id = p_product_id;
  if not selected_product.active and selected_product.setup_status = 'complete' then
    selected_action := 'reactivate';
  elsif coalesce((snapshot->>'eligible')::boolean, false) then
    selected_action := 'delete';
  elsif selected_product.active then
    selected_action := 'deactivate';
  else
    selected_action := 'reactivate';
    action_available := false;
  end if;
  return snapshot || jsonb_build_object('action', selected_action, 'actionAvailable', action_available);
end;
$$;
alter function public.get_product_management_eligibility(uuid) owner to postgres;
revoke all on function public.get_product_management_eligibility(uuid) from public, anon, authenticated;
grant execute on function public.get_product_management_eligibility(uuid) to service_role;

create or replace function public.begin_safe_product_deletion(p_product_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
volatile
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
  if p_actor_user_id is null or not exists(select 1 from auth.users user_account where user_account.id = p_actor_user_id) then
    raise insufficient_privilege using message = 'Administrative actor required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product_id::text, 0));
  select deletion.* into existing_job from public.product_draft_deletions deletion
  where deletion.product_id = p_product_id for update;
  if found and existing_job.status = 'completed' then
    return jsonb_build_object('operationId', existing_job.id, 'status', 'completed', 'storage', existing_job.storage_manifest);
  end if;
  select product.* into selected_product from public.products product where product.id = p_product_id for update;
  if not found then raise no_data_found using message = 'Product not found'; end if;
  perform 1 from public.product_variants variant where variant.product_id = p_product_id order by variant.id for update;
  eligibility := public.safe_product_deletion_snapshot(p_product_id);
  if not coalesce((eligibility->>'eligible')::boolean, false) then
    raise check_violation using message = 'Product is not eligible for physical deletion';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('imageId', image.id, 'bucket', image.storage_bucket, 'path', image.storage_path)
    order by image.position, image.id), '[]'::jsonb)
  into manifest from public.product_images image
  where image.product_id = p_product_id and image.storage_path is not null;
  update public.product_images image set status = 'delete_pending'
  where image.product_id = p_product_id and image.storage_path is not null and image.status <> 'delete_pending';
  insert into public.product_draft_deletions(product_id, product_sku, status, storage_manifest, actor_user_id, last_error_code)
  values(p_product_id, selected_product.sku, 'prepared', manifest, p_actor_user_id, null)
  on conflict(product_id) do update set status='prepared', storage_manifest=excluded.storage_manifest,
    actor_user_id=excluded.actor_user_id, completed_at=null, last_error_code=null
  returning id into job_id;
  return jsonb_build_object('operationId', job_id, 'status', 'prepared', 'storage', manifest);
end;
$$;
alter function public.begin_safe_product_deletion(uuid, uuid) owner to postgres;
revoke all on function public.begin_safe_product_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.begin_safe_product_deletion(uuid, uuid) to service_role;

create or replace function public.fail_safe_product_storage_deletion(p_product_id uuid, p_operation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.product_draft_deletions deletion
  set status='storage_failed', last_error_code='storage_delete_failed'
  where deletion.id=p_operation_id and deletion.product_id=p_product_id and deletion.status='prepared';
  if not found and not exists(select 1 from public.product_draft_deletions deletion
    where deletion.id=p_operation_id and deletion.product_id=p_product_id and deletion.status='storage_failed')
  then raise check_violation using message = 'Product deletion operation is not prepared'; end if;
end;
$$;
alter function public.fail_safe_product_storage_deletion(uuid, uuid) owner to postgres;
revoke all on function public.fail_safe_product_storage_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_safe_product_storage_deletion(uuid, uuid) to service_role;

create or replace function public.finalize_safe_product_deletion(p_product_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
volatile
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
  select deletion.* into selected_job from public.product_draft_deletions deletion
  where deletion.id=p_operation_id and deletion.product_id=p_product_id for update;
  if not found then raise no_data_found using message = 'Product deletion operation not found'; end if;
  if selected_job.status='completed' then
    return jsonb_build_object('deleted', true, 'idempotent', true, 'productId', p_product_id);
  end if;
  if selected_job.status <> 'prepared' then
    raise check_violation using message = 'Product deletion operation is not prepared';
  end if;
  select product.* into selected_product from public.products product where product.id=p_product_id for update;
  if not found then raise no_data_found using message = 'Product not found'; end if;
  perform 1 from public.product_variants variant where variant.product_id=p_product_id order by variant.id for update;

  if exists (
    select 1 from jsonb_array_elements(selected_job.storage_manifest) manifest(entry)
    join storage.objects object
      on object.bucket_id=manifest.entry->>'bucket' and object.name=manifest.entry->>'path'
  ) then
    update public.product_draft_deletions set status='finalize_blocked', last_error_code='storage_objects_remain'
    where id=p_operation_id;
    return jsonb_build_object('deleted', false, 'blockers', jsonb_build_array('storage_objects_remain'));
  end if;

  eligibility := public.safe_product_deletion_snapshot(p_product_id);
  if not coalesce((eligibility->>'eligible')::boolean, false) then
    update public.product_draft_deletions set status='finalize_blocked', last_error_code='eligibility_changed'
    where id=p_operation_id;
    return jsonb_build_object('deleted', false, 'blockers', eligibility->'blockers');
  end if;

  begin
    delete from public.product_images image where image.product_id=p_product_id;
    delete from public.product_slug_registry registry
    where registry.product_id=p_product_id and registry.is_current
      and registry.brand_id=selected_product.brand_id and registry.slug=selected_product.slug;
    get diagnostics removed_registry = row_count;
    if removed_registry <> 1 then
      raise integrity_constraint_violation using message = 'Current product slug was not removed exactly once';
    end if;
    delete from public.product_variants variant where variant.product_id=p_product_id;
    delete from public.products product where product.id=p_product_id;
    if not found then raise serialization_failure using message = 'Product changed during deletion'; end if;
  exception when foreign_key_violation or integrity_constraint_violation or serialization_failure then
    update public.product_draft_deletions set status='finalize_blocked', last_error_code='integrity_changed'
    where id=p_operation_id;
    return jsonb_build_object('deleted', false, 'blockers', jsonb_build_array('integrity_changed'));
  end;

  update public.product_draft_deletions
  set status='completed', completed_at=now(), last_error_code=null
  where id=p_operation_id;
  return jsonb_build_object('deleted', true, 'idempotent', false, 'productId', p_product_id);
end;
$$;
alter function public.finalize_safe_product_deletion(uuid, uuid) owner to postgres;
revoke all on function public.finalize_safe_product_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_safe_product_deletion(uuid, uuid) to service_role;

create or replace function public.deactivate_catalog_product(p_product_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare selected_product public.products%rowtype;
begin
  if p_actor_user_id is null or not exists(select 1 from auth.users user_account where user_account.id=p_actor_user_id) then
    raise insufficient_privilege using message='Administrative actor required';
  end if;
  select product.* into selected_product from public.products product where product.id=p_product_id for update;
  if not found then raise no_data_found using message='Product not found'; end if;
  if exists(select 1 from public.product_draft_deletions deletion where deletion.product_id=p_product_id and deletion.status<>'completed') then
    raise check_violation using message='Product has a pending deletion operation';
  end if;
  if not selected_product.active then
    return jsonb_build_object('active', false, 'idempotent', true, 'publicationStatus', selected_product.publication_status);
  end if;
  update public.products set active=false where id=p_product_id;
  return jsonb_build_object('active', false, 'idempotent', false, 'publicationStatus', selected_product.publication_status);
end;
$$;
alter function public.deactivate_catalog_product(uuid, uuid) owner to postgres;
revoke all on function public.deactivate_catalog_product(uuid, uuid) from public, anon, authenticated;
grant execute on function public.deactivate_catalog_product(uuid, uuid) to service_role;

create or replace function public.reactivate_catalog_product(p_product_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare selected_product public.products%rowtype; target_status text;
begin
  if p_actor_user_id is null or not exists(select 1 from auth.users user_account where user_account.id=p_actor_user_id) then
    raise insufficient_privilege using message='Administrative actor required';
  end if;
  select product.* into selected_product from public.products product where product.id=p_product_id for update;
  if not found then raise no_data_found using message='Product not found'; end if;
  if exists(select 1 from public.product_draft_deletions deletion where deletion.product_id=p_product_id and deletion.status<>'completed') then
    raise check_violation using message='Product has a pending deletion operation';
  end if;
  if selected_product.active then
    return jsonb_build_object('active', true, 'idempotent', true, 'publicationStatus', selected_product.publication_status);
  end if;
  if selected_product.setup_status <> 'complete' or not public.catalog_product_setup_is_complete(p_product_id) then
    raise check_violation using message='Complete the product before reactivating it';
  end if;
  target_status := case
    when selected_product.publication_status in ('published','archived') then 'ready'
    else selected_product.publication_status
  end;
  update public.products
  set active=true, publication_status=target_status,
      published_at=case when target_status='published' then published_at else null end
  where id=p_product_id;
  return jsonb_build_object('active', true, 'idempotent', false, 'publicationStatus', target_status);
end;
$$;
alter function public.reactivate_catalog_product(uuid, uuid) owner to postgres;
revoke all on function public.reactivate_catalog_product(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reactivate_catalog_product(uuid, uuid) to service_role;

comment on column public.products.first_published_at is
  'Historical, immutable timestamp of the first publication. It is never cleared by deactivation or editorial review.';
comment on function public.safe_product_deletion_snapshot(uuid) is
  'Conservative physical-deletion eligibility. Any publication history, commerce reference, unresolved FK or Storage inconsistency blocks deletion.';
comment on table public.product_draft_deletions is
  'Private tombstone shared by technical-draft and generalized safe product deletion sagas.';

commit;
