begin;

-- The public wrapper is the only callable entry point. It runs as the same
-- controlled owner as the private legacy chain so PostgreSQL can enter the
-- revoked helpers without exposing them directly to authenticated clients.
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
  item jsonb;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

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
    -- Any later error rolls this intermediate transition back atomically.
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

alter function public.save_catalog_product(jsonb, jsonb, jsonb) owner to postgres;
alter function public.save_catalog_product_legacy_016(jsonb, jsonb, jsonb) owner to postgres;
alter function public.save_catalog_product_legacy_015(jsonb, jsonb, jsonb) owner to postgres;

revoke all on function public.save_catalog_product_legacy_016(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_catalog_product_legacy_015(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;

commit;
