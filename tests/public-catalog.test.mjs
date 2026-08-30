import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260830033207_public_catalog_taxonomy.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");
const types = await readFile(new URL("../src/lib/types.ts", import.meta.url), "utf8");
const catalog = await readFile(new URL("../src/lib/storefront/catalog.ts", import.meta.url), "utf8");
const productForm = await readFile(new URL("../src/components/product-form.tsx", import.meta.url), "utf8");
const storefrontHeader = await readFile(new URL("../src/components/storefront/storefront-header.tsx", import.meta.url), "utf8");
const advisorSearch = await readFile(new URL("../src/lib/catalog-search.ts", import.meta.url), "utf8");
const saveSection = migration.slice(migration.indexOf("create or replace function public.save_catalog_product"), migration.indexOf("create or replace function public.publish_catalog_product"));
const publishSection = migration.slice(migration.indexOf("create or replace function public.publish_catalog_product"), migration.indexOf("create or replace function public.change_catalog_product_slug"));

test("014 crea taxonomía y los campos editoriales sin eliminar columnas legacy", () => {
  assert.match(migration, /create table public\.brands/);
  assert.match(migration, /create table public\.categories/);
  for (const field of ["brand_id", "category_id", "slug", "short_description", "publication_status", "published_at", "seo_title", "seo_description"]) assert.match(migration, new RegExp(`add column ${field}`));
  for (const legacy of ["products.price", "products.category", "products.subcategory", "product_variants.color", "product_variants.size", "product_variants.stock"]) assert.doesNotMatch(migration, new RegExp(`drop (column )?${legacy.replace(".", "\\.")}`, "i"));
});

test("014 garantiza slugs distintos para categorías raíz e hijas", () => {
  assert.match(migration, /categories_root_slug_key[\s\S]*where parent_id is null/);
  assert.match(migration, /categories_child_slug_key[\s\S]*where parent_id is not null/);
  assert.match(migration, /validate_category_parent/);
  assert.match(migration, /jerarquía de categorías no puede contener ciclos/);
});

test("014 siembra Columpio Mujer y las seis categorías aprobadas", () => {
  assert.match(migration, /'COLUMPIO_MUJER', 'Columpio Mujer', 'mujer', true/);
  for (const slug of ["vestidos", "blusas", "poleras", "pantalones", "chaquetas", "accesorios"]) assert.match(migration, new RegExp(`'${slug}'`));
});

test("el backfill conserva category y subcategory y no publica productos", () => {
  assert.match(migration, /El mapeo consulta category y subcategory, pero no los modifica/);
  assert.doesNotMatch(migration, /set\s+(category|subcategory)\s*=/i);
  assert.match(migration, /publication_status = case when public\.catalog_product_is_complete/);
  assert.match(migration, /publication_status = 'published' or published_at is not null/);
  assert.match(migration, /014 no puede publicar productos durante el backfill/);
});

test("registry e historial reservan slugs actuales e históricos por marca", () => {
  assert.match(migration, /create table public\.product_slug_registry/);
  assert.match(migration, /product_slug_registry_brand_slug_key unique \(brand_id, slug\)/);
  assert.match(migration, /product_slug_registry_current_product_key[\s\S]*where is_current/);
  assert.match(migration, /create table public\.product_slug_history/);
  assert.match(migration, /product_slug_history_brand_slug_key unique \(brand_id, slug\)/);
});

test("el cambio de slug es transaccional, serializado y conserva historial", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/);
  assert.match(migration, /set is_current = false, retired_at = now\(\)/);
  assert.match(migration, /insert into public\.product_slug_history/);
  assert.match(migration, /products_change_slug_before_update/);
  assert.match(migration, /constraint trigger products_slug_integrity_deferred/);
  assert.match(migration, /deferrable initially deferred/);
});

test("guardar conserva la firma y no puede publicar por primera vez", () => {
  assert.match(migration, /save_catalog_product\(\s*p_product jsonb,\s*p_variants jsonb,\s*p_images jsonb default '\[\]'::jsonb/s);
  assert.match(migration, /Usa publish_catalog_product para publicar/);
  assert.match(migration, /create or replace function public\.publish_catalog_product/);
  assert.match(migration, /catalog_product_is_complete\(p_product_id\)/);
});

test("las RPC públicas filtran sólo productos activos y publicados", () => {
  for (const rpc of ["list_public_products", "get_public_product_by_slug", "list_public_categories"]) assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`));
  assert.match(migration, /product\.active[\s\S]*product\.publication_status = 'published'/);
  assert.doesNotMatch(migration, /grant select[^;]*public\.products[^;]*to anon/i);
});

test("las RPC no exponen stock exacto y entregan disponibilidad booleana", () => {
  const publicRpcSection = migration.slice(migration.indexOf("create or replace function public.list_public_products"));
  assert.match(publicRpcSection, /is_available boolean/);
  assert.match(publicRpcSection, /'available', \(variant\.stock > 0\)/);
  assert.doesNotMatch(publicRpcSection, /'stock'\s*,\s*variant\.stock/);
});

test("las tablas nuevas mantienen RLS y anon sólo recibe EXECUTE de lectura", () => {
  for (const table of ["brands", "categories", "product_slug_registry", "product_slug_history"]) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, /revoke all on table public\.brands, public\.categories, public\.product_slug_registry, public\.product_slug_history from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.list_public_products\(text, integer\) to anon, authenticated/);
});

test("el formulario soporta taxonomía, SEO y publicación explícita", () => {
  for (const field of ["brandId", "categoryId", "slug", "shortDescription", "publicationStatus", "seoTitle", "seoDescription"]) assert.match(types, new RegExp(field));
  assert.match(productForm, /Publicar explícitamente/);
  assert.match(productForm, /publishProduct\(product\.id\)/);
  assert.match(productForm, /Guardar cambios/);
});

test("el storefront usa exclusivamente las RPC reales y conserva mocks aislados", () => {
  assert.match(catalog, /list_public_products/);
  assert.match(catalog, /get_public_product_by_slug/);
  assert.match(catalog, /list_public_categories/);
  assert.doesNotMatch(catalog, /mock-data|mockProducts/);
  assert.doesNotMatch(storefrontHeader, /mock-data|mockCollections/);
});

test("la consulta del advisor conserva el contrato legacy", () => {
  assert.match(advisorSearch, /\.from\("products"\)/);
  assert.match(advisorSearch, /product_variants/);
  assert.match(advisorSearch, /product_images/);
  assert.match(advisorSearch, /variant\.stock/);
  assert.doesNotMatch(advisorSearch, /publication_status|list_public_products/);
});

test("014 usa una transacción explícita completa", () => {
  assert.ok(migration.indexOf("begin;") < migration.indexOf("create table public.brands"));
  assert.match(migration.trimEnd(), /commit;$/);
  assert.doesNotMatch(migration, /create\s+(unique\s+)?index\s+concurrently/i);
});

test("las funciones sensibles pierden EXECUTE público junto a su definición", () => {
  for (const [nextFunction, revokedFunction] of [
    ["validate_category_parent", "catalog_slugify"],
    ["register_product_slug_after_insert", "validate_category_parent"],
    ["change_product_slug_before_update", "register_product_slug_after_insert"],
    ["protect_product_slug_identity", "validate_product_slug_integrity_deferred"],
    ["publish_catalog_product", "save_catalog_product"],
    ["change_catalog_product_slug", "publish_catalog_product"],
    ["get_public_product_by_slug", "list_public_products"],
    ["list_public_categories", "get_public_product_by_slug"],
  ]) {
    const createIndex = migration.indexOf(`create or replace function public.${revokedFunction}`);
    const revokeIndex = migration.indexOf(`revoke all on function public.${revokedFunction}`, createIndex);
    const nextIndex = migration.indexOf(`create or replace function public.${nextFunction}`, createIndex + 1);
    assert.ok(createIndex >= 0 && revokeIndex > createIndex && revokeIndex < nextIndex, `${revokedFunction} debe revocarse antes de ${nextFunction}`);
  }
});

test("un update legacy conserva campos editoriales ausentes", () => {
  assert.match(saveSection, /elsif is_existing then\s+desired_brand_id := existing_product\.brand_id/);
  assert.match(saveSection, /elsif is_existing then\s+desired_category_id := existing_product\.category_id/);
  assert.match(saveSection, /elsif is_existing then\s+desired_slug := existing_product\.slug/);
  assert.match(saveSection, /elsif is_existing then\s+desired_status := existing_product\.publication_status/);
  for (const field of ["short_description", "seo_title", "seo_description"]) assert.match(saveSection, new RegExp(`existing_product\\.${field}`));
  assert.match(saveSection, /desired_published_at := case when desired_status = 'published' then existing_product\.published_at/);
});

test("save distingue campo ausente de null explícito", () => {
  assert.match(saveSection, /p_product \? 'category_id'[\s\S]*jsonb_typeof\(p_product->'category_id'\) = 'null'[\s\S]*then null/);
  for (const field of ["brand_id", "slug", "publication_status", "short_description", "seo_title", "seo_description"]) {
    assert.match(saveSection, new RegExp(`p_product \\? '${field}'[\\s\\S]*jsonb_typeof\\(p_product->'${field}'\\) = 'null'`));
  }
});

test("publicar dos veces es idempotente y no reemplaza published_at", () => {
  assert.match(publishSection, /if current_status = 'published' then[\s\S]*catalog_product_is_complete\(p_product_id\)[\s\S]*return;/);
  assert.equal((publishSection.match(/published_at = now\(\)/g) ?? []).length, 1);
});

test("draft no puede publicarse directamente", () => {
  assert.match(publishSection, /if current_status <> 'ready' then/);
});

test("archived no puede publicarse directamente", () => {
  assert.match(publishSection, /Solo un producto ready puede publicarse/);
});

test("ready completo establece la primera fecha de publicación", () => {
  assert.match(publishSection, /catalog_product_is_complete\(p_product_id\)/);
  assert.match(publishSection, /set publication_status = 'published', published_at = now\(\)/);
});

test("producto inactivo bloquea publicación", () => {
  assert.match(migration, /where product\.id = p_product_id\s+and product\.active/);
});

test("marca inactiva bloquea publicación", () => {
  assert.match(migration, /from public\.brands brand\s+where brand\.id = product\.brand_id and brand\.active/);
});

test("categoría inactiva o de otra marca bloquea publicación", () => {
  assert.match(migration, /category\.id = product\.category_id\s+and category\.brand_id = product\.brand_id\s+and category\.active/);
});

test("authenticated sólo puede leer brands y categories", () => {
  assert.match(migration, /grant select on table public\.brands, public\.categories to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*(insert|update|delete)[^;]*public\.(brands|categories)/i);
  assert.match(migration, /for select to authenticated using \(true\)/);
  assert.doesNotMatch(migration, /for all to authenticated/);
});

test("productos con URL reservada se archivan y no se borran físicamente", () => {
  assert.match(migration, /product_id uuid not null references public\.products\(id\) on delete restrict/);
  assert.match(migration, /no se borra físicamente: se desactiva y archiva/);
  assert.doesNotMatch(migration, /product_slug_registry[\s\S]{0,200}on delete cascade/);
});
