import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260830152222_product_image_storage.sql", import.meta.url), "utf8");
const types = await readFile(new URL("../src/lib/types.ts", import.meta.url), "utf8");
const catalogMapper = await readFile(new URL("../src/lib/catalog.ts", import.meta.url), "utf8");
const imageManager = await readFile(new URL("../src/components/product-image-manager.tsx", import.meta.url), "utf8");
const productForm = await readFile(new URL("../src/components/product-form.tsx", import.meta.url), "utf8");
const storefrontCatalog = await readFile(new URL("../src/lib/storefront/catalog.ts", import.meta.url), "utf8");
const productCard = await readFile(new URL("../src/components/storefront/product-card.tsx", import.meta.url), "utf8");
const productPage = await readFile(new URL("../src/app/(storefront)/producto/[slug]/page.tsx", import.meta.url), "utf8");
const advisorSearch = await readFile(new URL("../src/lib/catalog-search.ts", import.meta.url), "utf8");

test("015 es aditiva, transaccional y conserva product_images legacy", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  for (const field of ["storage_bucket", "storage_path", "mime_type", "width", "height", "file_size", "status", "created_at", "updated_at"]) assert.match(migration, new RegExp(`add column ${field}`));
  for (const field of ["id", "product_id", "image_url", "position", "alt_text"]) assert.doesNotMatch(migration, new RegExp(`drop column ${field}`, "i"));
  assert.doesNotMatch(migration, /create or replace function public\.catalog_product_is_complete/);
  assert.doesNotMatch(migration, /update public\.products[\s\S]{0,120}publication_status\s*=/i);
});

test("firmas RETURNS TABLE evitan identificadores ambiguos de PostgreSQL", () => {
  const signatures = [...migration.matchAll(/returns table\s*\(([^)]*)\)/gi)].map((match) => match[1]);
  const unsafe = new Set(["position", "authorization", "current_schema", "is", "like", "join", "left", "right"]);
  for (const signature of signatures) {
    const names = signature.split(",").map((column) => column.trim().split(/\s+/)[0].toLowerCase());
    assert.deepEqual(names.filter((name) => unsafe.has(name)), []);
  }
  assert.match(migration, /image_position integer/);
  assert.match(imageManager, /row\?\.image_position/);
});

test("015 crea el bucket público con límite y MIME exactos", () => {
  assert.match(migration, /values \('product-images', 'product-images', true, 5242880/);
  for (const mime of ["image/jpeg", "image/png", "image/webp"]) assert.match(migration, new RegExp(`'${mime}'`));
  assert.match(migration, /p_product_id::text \|\| '\/' \|\| p_image_id::text/);
});

test("policies impiden escritura anon y limitan authenticated al bucket", () => {
  assert.doesNotMatch(migration, /create policy[^;]*for select to (public|anon)/i);
  assert.match(migration, /for select to authenticated[\s\S]*bucket_id = 'product-images'[\s\S]*image\.storage_path = name/);
  assert.match(migration, /for insert to authenticated[\s\S]*bucket_id = 'product-images'/);
  assert.match(migration, /for delete to authenticated[\s\S]*bucket_id = 'product-images'/);
  assert.doesNotMatch(migration, /for (insert|update|delete) to anon/i);
  assert.doesNotMatch(migration, /for update to authenticated/i);
  assert.match(migration, /No se crea policy UPDATE/);
});

test("estados, MIME, tamaño y metadata quedan restringidos", () => {
  for (const status of ["pending", "ready", "delete_pending", "failed"]) assert.match(migration, new RegExp(`'${status}'`));
  assert.match(migration, /file_size between 1 and 5242880/);
  assert.match(migration, /product_images_mime_check/);
  for (const field of ["storageBucket", "storagePath", "mimeType", "fileSize", "status"]) assert.match(types, new RegExp(field));
});

test("saga de upload reserva, finaliza, falla y cancela", () => {
  for (const rpc of ["reserve_product_image_upload", "finalize_product_image_upload", "fail_product_image_upload", "cancel_product_image_upload"]) assert.match(migration, new RegExp(`function public\\.${rpc}`));
  assert.match(imageManager, /upsert: false/);
  assert.match(imageManager, /reserve_product_image_upload/);
  assert.match(imageManager, /\.upload\(storagePath/);
  assert.match(imageManager, /finalize_product_image_upload/);
  assert.match(imageManager, /fail_product_image_upload/);
});

test("saga de borrado usa delete_pending y compensación", () => {
  for (const rpc of ["begin_product_image_deletion", "finalize_product_image_deletion", "cancel_product_image_deletion"]) assert.match(migration, new RegExp(`function public\\.${rpc}`));
  assert.match(imageManager, /begin_product_image_deletion/);
  assert.match(imageManager, /storage\.from\(BUCKET\)\.remove/);
  assert.match(imageManager, /cancel_product_image_deletion/);
  assert.match(imageManager, /finalize_product_image_deletion/);
});

test("reordenamiento es transaccional y position cero define principal", () => {
  assert.match(migration, /function public\.reorder_product_images/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /with ordinality/);
  assert.match(imageManager, /Hacer principal/);
  assert.match(imageManager, />Principal</);
  assert.match(productCard, /find\(\(image\) => image\.position === 0\)/);
});

test("reordenamiento rechaza IDs duplicados antes de actualizar posiciones", () => {
  assert.match(migration, /input_count := pg_catalog\.cardinality/);
  assert.match(migration, /supplied_count <> input_count/);
  assert.match(migration, /ready_count <> input_count/);
  assert.match(migration, /image\.id = supplied\.image_id/);
});

test("borrar la principal promueve primero las imágenes ready", () => {
  assert.match(migration, /order by case when status = 'ready' then 0 else 1 end, position, id/);
  assert.match(migration, /row_number\(\) over/);
});

test("save_catalog_product preserva filas Storage omitidas y su metadata", () => {
  assert.match(migration, /rename to save_catalog_product_legacy_015/);
  assert.match(migration, /protect_storage_images_during_catalog_save/);
  assert.match(migration, /old\.storage_path is not null/);
  assert.match(migration, /current_setting\('columpio\.preserve_storage_images', true\) = 'on'/);
  assert.match(migration, /set_config\('columpio\.preserve_storage_images', 'on', true\)/);
  assert.doesNotMatch(migration, /storage_images public\.product_images\[\]|foreach storage_image/);
  assert.match(catalogMapper, /input\.images\.filter\(\(image\) => !image\.storagePath\)/);
});

test("Storage 0 y 1 conserva filas y desplaza URL legacy a posición 2", () => {
  assert.match(migration, /select max\(image\.position\) into storage_max_position/);
  assert.match(migration, /storage_max_position \+ requested\.normalized_ordinal/);
  assert.match(migration, /order by coalesce\(nullif\(item\.value->>'position', ''\)::integer, item\.ordinal::integer\), item\.ordinal/);
  assert.match(migration, /storage_image\.id::text = item\.value->>'id'/);
});

test("RPC públicas entregan exclusivamente imágenes ready", () => {
  assert.equal((migration.match(/image\.status = 'ready'/g) ?? []).length >= 2, true);
  assert.match(storefrontCatalog, /sort\(\(left, right\) => left\.position - right\.position\)/);
  assert.match(productPage, /product\.images\.length/);
});

test("administración exige producto real y valida archivos", () => {
  assert.match(productForm, /Guarda primero el producto/);
  assert.match(productForm, /ProductImageManager productId=\{product\.id\}/);
  assert.match(imageManager, /MAX_FILE_SIZE = 5 \* 1024 \* 1024/);
  assert.match(imageManager, /image\/jpeg/);
  assert.match(imageManager, /imageDimensions/);
  assert.match(imageManager, /multiple accept=/);
});

test("advisor mantiene precio, variantes, stock e imágenes legacy", () => {
  assert.match(advisorSearch, /\.from\("products"\)/);
  assert.match(advisorSearch, /product_variants/);
  assert.match(advisorSearch, /product_images/);
  assert.match(advisorSearch, /variant\.stock/);
  assert.doesNotMatch(advisorSearch, /reserve_product_image_upload|storage_path|publication_status/);
});
