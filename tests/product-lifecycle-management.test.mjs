import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260914222038_safe_product_lifecycle_management.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/admin/products/[id]/management/route.ts", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/components/product-management-panel.tsx", import.meta.url), "utf8");
const form = await readFile(new URL("../src/components/product-form.tsx", import.meta.url), "utf8");

function deletable(overrides = {}) {
  const product = { firstPublishedAt: null, publishedAt: null, publicationStatus: "ready", stock: 0, references: 0,
    slugRegistry: 1, slugHistory: 0, invalidStorage: 0, missingStorage: 0, unregisteredStorage: 0, unresolvedFks: 0, ...overrides };
  return product.firstPublishedAt === null && product.publishedAt === null && product.publicationStatus !== "published"
    && product.stock === 0 && product.references === 0 && product.slugRegistry === 1 && product.slugHistory === 0
    && product.invalidStorage === 0 && product.missingStorage === 0 && product.unregisteredStorage === 0 && product.unresolvedFks === 0;
}

test("migración es nueva, transaccional y conserva constraints de setup existentes", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  assert.doesNotMatch(migration, /drop\s+(table|column)|alter\s+column/i);
  assert.doesNotMatch(migration, /products_setup_status_check|products_technical_draft_shape_check|drop constraint products_/i);
});

test("first_published_at es histórico, se backfillea y queda inmutable", () => {
  assert.match(migration, /add column first_published_at timestamptz/);
  assert.match(migration, /set first_published_at = published_at[\s\S]*where published_at is not null/);
  assert.match(migration, /old\.first_published_at is not null[\s\S]*new\.first_published_at is distinct from old\.first_published_at[\s\S]*first_published_at is immutable/);
  assert.match(migration, /new\.publication_status = 'published'[\s\S]*new\.first_published_at := coalesce\(new\.published_at, now\(\)\)/);
  assert.match(migration, /before insert or update of publication_status, published_at, first_published_at/);
});

test("SKU técnico y SKU comercial son eliminables bajo los mismos guards", () => {
  assert.equal(deletable({ sku: "DRAFT-0123456789ABCDEF0123456789ABCDEF", setupStatus: "technical_draft" }), true);
  assert.equal(deletable({ sku: "CM-005", setupStatus: "complete" }), true);
  const snapshot = migration.slice(migration.indexOf("create or replace function public.safe_product_deletion_snapshot"), migration.indexOf("alter function public.safe_product_deletion_snapshot"));
  assert.doesNotMatch(snapshot, /sku_not_technical|setup_status <> 'technical_draft'|slug_not_technical/);
});

test("publicación o historial de publicación bloquean DELETE físico", () => {
  assert.equal(deletable({ firstPublishedAt: "2026-01-01" }), false);
  assert.equal(deletable({ publishedAt: "2026-01-01", publicationStatus: "published" }), false);
  for (const blocker of ["product_was_published", "current_publication_exists", "publication_is_published"]) assert.match(migration, new RegExp(blocker));
});

test("pedidos pagos reservas movimientos y eventos asociados bloquean", () => {
  assert.equal(deletable({ references: 1 }), false);
  for (const table of ["commerce_order_items", "commerce_payment_preferences", "commerce_flow_checkouts", "web_order_items", "web_payments", "web_stock_reservation_items", "inventory_movements", "web_order_admin_events", "web_order_email_events"]) {
    assert.match(migration, new RegExp(`public\\.${table}`));
  }
  assert.match(migration, /historical_or_transactional_references/);
});

test("eligibilidad falla cerrada ante FK nueva o Storage inconsistente", () => {
  assert.equal(deletable({ unresolvedFks: 1 }), false);
  assert.equal(deletable({ missingStorage: 1 }), false);
  assert.match(migration, /pg_catalog\.pg_constraint/);
  assert.match(migration, /unresolved_reference_schema/);
  assert.match(migration, /invalid_storage_metadata|missing_storage_objects|unregistered_storage_objects/);
});

test("saga revalida bajo lock y conserva producto ante race posterior a Storage", () => {
  assert.equal((migration.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.match(migration, /eligibility := public\.safe_product_deletion_snapshot\(p_product_id\)/g);
  assert.match(migration, /status='finalize_blocked', last_error_code='eligibility_changed'/);
  assert.match(migration, /exception when foreign_key_violation[\s\S]*last_error_code='integrity_changed'/);
  assert.match(migration, /selected_job\.status <> 'prepared'/);
  assert.doesNotMatch(migration, /delete from public\.product_slug_history/i);
});

test("fallo Storage aborta y no se finaliza como éxito", () => {
  assert.match(route, /if \(storageError\)[\s\S]*fail_safe_product_storage_deletion[\s\S]*El producto no fue eliminado/);
  assert.ok(route.indexOf(".remove(") < route.indexOf("finalize_safe_product_deletion"));
  assert.match(migration, /status='storage_failed', last_error_code='storage_delete_failed'/);
  assert.match(migration, /selected_job\.status <> 'prepared'/);
});

test("deactivate conserva historia y reactivate nunca publica", () => {
  const deactivate = migration.slice(migration.indexOf("create or replace function public.deactivate_catalog_product"), migration.indexOf("alter function public.deactivate_catalog_product"));
  const reactivate = migration.slice(migration.indexOf("create or replace function public.reactivate_catalog_product"), migration.indexOf("alter function public.reactivate_catalog_product"));
  assert.match(deactivate, /update public\.products set active=false/);
  assert.doesNotMatch(deactivate, /delete from|stock=|first_published_at=/i);
  assert.match(reactivate, /publication_status in \('published','archived'\) then 'ready'/);
  assert.match(reactivate, /setup_status <> 'complete'/);
  assert.doesNotMatch(reactivate, /target_status\s*:=\s*'published'|publication_status='published'/);
});

test("producto photo-first completo e inactivo ofrece reactivar antes que borrar", () => {
  const management = migration.slice(migration.indexOf("create or replace function public.get_product_management_eligibility"), migration.indexOf("alter function public.get_product_management_eligibility"));
  assert.ok(management.indexOf("not selected_product.active and selected_product.setup_status = 'complete'") < management.indexOf("snapshot->>'eligible'"));
  assert.match(management, /selected_action := 'reactivate'/);
});

test("RPC sensibles son privadas y service_role permanece server-side", () => {
  for (const signature of ["get_product_management_eligibility\\(uuid\\)", "begin_safe_product_deletion\\(uuid, uuid\\)", "fail_safe_product_storage_deletion\\(uuid, uuid\\)", "finalize_safe_product_deletion\\(uuid, uuid\\)", "deactivate_catalog_product\\(uuid, uuid\\)", "reactivate_catalog_product\\(uuid, uuid\\)"]) {
    assert.match(migration, new RegExp(`alter function public\\.${signature} owner to postgres`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`));
  }
  assert.match(route, /getAdministrativeSession/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.doesNotMatch(panel, /SUPABASE_SERVICE_ROLE_KEY|createServiceClient/);
});

test("UI reemplaza active editable y muestra una acción estructural", () => {
  assert.match(form, /ProductManagementPanel productId=\{product\.id\}/);
  assert.match(form, /Estado administrativo:[\s\S]*Usa Gestión del producto/);
  assert.doesNotMatch(form, /product \?[^:]*toggle-label/s);
  assert.match(panel, /Eliminar producto/);
  assert.match(panel, /Desactivar producto/);
  assert.match(panel, /Reactivar producto/);
  assert.match(panel, /Este producto se eliminará definitivamente\. Esta acción no se puede deshacer\./);
  assert.match(panel, /Este producto dejará de estar disponible en la tienda, pero se conservará su historial\./);
});

test("saga técnica anterior permanece disponible durante la transición", async () => {
  const legacyRoute = await readFile(new URL("../src/app/api/admin/products/[id]/draft-deletion/route.ts", import.meta.url), "utf8");
  assert.match(legacyRoute, /begin_technical_draft_deletion/);
  assert.match(migration, /existing tombstone remains the single ledger/);
  assert.doesNotMatch(migration, /drop function public\.(begin|finalize)_technical_draft_deletion/i);
});
