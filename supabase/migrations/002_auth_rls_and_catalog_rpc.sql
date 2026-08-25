-- Bloque 1A.1: acceso exclusivo para sesiones autenticadas.
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;

revoke all on table public.products from anon, authenticated;
revoke all on table public.product_variants from anon, authenticated;
revoke all on table public.product_images from anon, authenticated;

grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.product_variants to authenticated;
grant select, insert, update, delete on table public.product_images to authenticated;

drop policy if exists "Authenticated users select products" on public.products;
drop policy if exists "Authenticated users insert products" on public.products;
drop policy if exists "Authenticated users update products" on public.products;
drop policy if exists "Authenticated users delete products" on public.products;
create policy "Authenticated users select products" on public.products for select to authenticated using (true);
create policy "Authenticated users insert products" on public.products for insert to authenticated with check (true);
create policy "Authenticated users update products" on public.products for update to authenticated using (true) with check (true);
create policy "Authenticated users delete products" on public.products for delete to authenticated using (true);

drop policy if exists "Authenticated users select variants" on public.product_variants;
drop policy if exists "Authenticated users insert variants" on public.product_variants;
drop policy if exists "Authenticated users update variants" on public.product_variants;
drop policy if exists "Authenticated users delete variants" on public.product_variants;
create policy "Authenticated users select variants" on public.product_variants for select to authenticated using (true);
create policy "Authenticated users insert variants" on public.product_variants for insert to authenticated with check (true);
create policy "Authenticated users update variants" on public.product_variants for update to authenticated using (true) with check (true);
create policy "Authenticated users delete variants" on public.product_variants for delete to authenticated using (true);

drop policy if exists "Authenticated users select images" on public.product_images;
drop policy if exists "Authenticated users insert images" on public.product_images;
drop policy if exists "Authenticated users update images" on public.product_images;
drop policy if exists "Authenticated users delete images" on public.product_images;
create policy "Authenticated users select images" on public.product_images for select to authenticated using (true);
create policy "Authenticated users insert images" on public.product_images for insert to authenticated with check (true);
create policy "Authenticated users update images" on public.product_images for update to authenticated using (true) with check (true);
create policy "Authenticated users delete images" on public.product_images for delete to authenticated using (true);

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
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required';
  end if;

  insert into public.products (
    id, sku, name, description, category, subcategory, price, style, season,
    formality, fit, material, occasions, active
  ) values (
    saved_id, upper(trim(p_product->>'sku')), trim(p_product->>'name'), coalesce(trim(p_product->>'description'), ''),
    trim(p_product->>'category'), coalesce(trim(p_product->>'subcategory'), ''), (p_product->>'price')::numeric,
    coalesce(trim(p_product->>'style'), ''), coalesce(trim(p_product->>'season'), ''),
    coalesce(trim(p_product->>'formality'), ''), coalesce(trim(p_product->>'fit'), ''),
    coalesce(trim(p_product->>'material'), ''),
    coalesce(array(select jsonb_array_elements_text(p_product->'occasions')), '{}'::text[]),
    coalesce((p_product->>'active')::boolean, true)
  )
  on conflict (id) do update set
    sku = excluded.sku, name = excluded.name, description = excluded.description,
    category = excluded.category, subcategory = excluded.subcategory, price = excluded.price,
    style = excluded.style, season = excluded.season, formality = excluded.formality,
    fit = excluded.fit, material = excluded.material, occasions = excluded.occasions, active = excluded.active;

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

  return saved_id;
end;
$$;

revoke all on function public.save_catalog_product(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_catalog_product(jsonb, jsonb, jsonb) to authenticated;

