import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260913162649_delete_orphan_technical_drafts.sql", import.meta.url), "utf8");
const regexFixMigration = await readFile(new URL("../supabase/migrations/20260913171009_fix_technical_draft_storage_path_regex.sql", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/admin/products/[id]/draft-deletion/route.ts", import.meta.url), "utf8");
const button = await readFile(new URL("../src/components/delete-technical-draft-button.tsx", import.meta.url), "utf8");
const form = await readFile(new URL("../src/components/product-form.tsx", import.meta.url), "utf8");

function eligibleDraft(overrides = {}) {
  const draft = {
    setupStatus: "technical_draft", sku: "DRAFT-0123456789ABCDEF0123456789ABCDEF",
    publicationStatus: "draft", active: false, publishedAt: null, technicalSlugReleasable: true,
    totalStock: 0, references: 0, slugHistory: 0, slugRegistry: 1, invalidStorage: 0,
    unregisteredStorage: 0, ...overrides,
  };
  return draft.setupStatus === "technical_draft" && /^DRAFT-[0-9A-F]{32}$/.test(draft.sku)
    && draft.publicationStatus === "draft" && !draft.active && draft.publishedAt === null
    && draft.technicalSlugReleasable && draft.totalStock === 0 && draft.references === 0
    && draft.slugHistory === 0 && draft.slugRegistry === 1 && draft.invalidStorage === 0
    && draft.unregisteredStorage === 0;
}

function validStorageMetadata(productId, imageId, path, bucket = "product-images") {
  return bucket === "product-images" && new RegExp(`^${productId}/${imageId}\\.(jpg|jpeg|png|webp)$`).test(path);
}

test("correctiva reemplaza exclusivamente el escape adicional del regex", () => {
  const originalFunction = migration.slice(
    migration.indexOf("create or replace function public.technical_draft_deletion_snapshot"),
    migration.indexOf("alter function public.technical_draft_deletion_snapshot"),
  ).trim();
  const correctedFunction = regexFixMigration.slice(
    regexFixMigration.indexOf("create or replace function public.technical_draft_deletion_snapshot"),
    regexFixMigration.indexOf("commit;"),
  ).trim();
  assert.match(migration, /image\.storage_path !~[\s\S]*'\\\\\.\(jpg\|jpeg\|png\|webp\)\$'/);
  assert.match(regexFixMigration, /image\.storage_path !~[\s\S]*'\\\.\(jpg\|jpeg\|png\|webp\)\$'/);
  assert.equal(correctedFunction, originalFunction.replace(String.raw`\\.(jpg|jpeg|png|webp)$`, String.raw`\.(jpg|jpeg|png|webp)$`));
  assert.doesNotMatch(regexFixMigration, /grant |revoke |alter table|create table|delete from|update public|insert into/i);
});

test("regex corregido acepta extensiones de imagen permitidas", () => {
  const productId = "f47aa12f-bd28-427b-9c9d-af46e9ba83ed";
  const imageId = "fb70185b-f7cc-483a-a94f-5625df11a160";
  for (const extension of ["png", "jpg", "jpeg", "webp"]) {
    assert.equal(validStorageMetadata(productId, imageId, `${productId}/${imageId}.${extension}`), true);
  }
});

test("regex corregido rechaza extensión, producto o metadata inconsistentes", () => {
  const productId = "f47aa12f-bd28-427b-9c9d-af46e9ba83ed";
  const imageId = "fb70185b-f7cc-483a-a94f-5625df11a160";
  assert.equal(validStorageMetadata(productId, imageId, `${productId}/${imageId}.gif`), false);
  assert.equal(validStorageMetadata(productId, imageId, `e8024654-3910-442a-a660-6c5a57fc51f8/${imageId}.png`), false);
  assert.equal(validStorageMetadata(productId, imageId, `${productId}/447bdadf-90f1-4bd4-a651-9cde9e8dbf18.png`), false);
  assert.equal(validStorageMetadata(productId, imageId, `${productId}/${imageId}.png`, "other-bucket"), false);
});

test("migración es nueva, transaccional y no altera estructuras comerciales", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  assert.doesNotMatch(migration, /drop\s+(table|column)|alter\s+table\s+public\.(products|product_variants|web_orders|web_payments)\s+(drop|alter\s+column)/i);
  assert.match(migration, /create table public\.product_draft_deletions/);
});

test("elegibilidad exige simultáneamente identidad técnica, inactividad, no publicación y stock cero", () => {
  for (const token of ["setup_status <> 'technical_draft'", "sku !~ '^DRAFT-[0-9A-F]{32}$'", "publication_status <> 'draft'", "selected_product.active", "published_at is not null", "not selected_product.technical_slug_releasable", "total_stock <> 0"]) {
    assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(eligibleDraft(), true);
  assert.equal(eligibleDraft({ active: true }), false);
  assert.equal(eligibleDraft({ publicationStatus: "published", publishedAt: "2026-01-01" }), false);
  assert.equal(eligibleDraft({ sku: "CM-004" }), false);
  assert.equal(eligibleDraft({ setupStatus: "complete", sku: "CM-004" }), false);
});

test("draft elegible funciona con o sin imágenes propias válidas", () => {
  assert.equal(eligibleDraft({ imageCount: 0 }), true);
  assert.equal(eligibleDraft({ imageCount: 2 }), true);
  assert.match(migration, /image\.storage_path !~ \('\^' \|\| p_product_id::text/);
  assert.match(migration, /unregistered_storage_objects/);
});

test("toda referencia transaccional o histórica bloquea el borrado", () => {
  for (const table of ["commerce_cart_items", "commerce_order_items", "commerce_payment_preferences", "commerce_flow_checkouts", "commerce_operations", "instagram_conversations", "web_cart_items", "web_order_items", "web_payments", "web_stock_reservation_items", "inventory_movements", "web_promotion_targets", "product_slug_history"]) {
    assert.match(migration, new RegExp(`public\\.${table}`));
  }
  assert.equal(eligibleDraft({ references: 1 }), false);
  assert.equal(eligibleDraft({ slugHistory: 1 }), false);
  assert.match(migration, /historical_or_transactional_references/);
});

test("productos comerciales permanecen excluidos aunque editorialmente sean draft", () => {
  for (const name of ["Blusa sin mangas con botones", "Blusa Amelia", "Blazer Emilia", "Pantalón Renata"]) {
    assert.equal(eligibleDraft({ name, setupStatus: "complete", sku: "CM-001" }), false);
  }
  assert.doesNotMatch(migration, /delete from public\.products[\s\S]*where product\.name/i);
});

test("RPC privadas usan owner y search_path seguros", () => {
  for (const signature of ["get_technical_draft_deletion_eligibility\\(uuid\\)", "begin_technical_draft_deletion\\(uuid, uuid\\)", "fail_technical_draft_storage_deletion\\(uuid, uuid\\)", "finalize_technical_draft_deletion\\(uuid, uuid\\)"]) {
    assert.match(migration, new RegExp(`alter function public\\.${signature} owner to postgres`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`));
  }
  assert.equal((migration.match(/security definer/g) ?? []).length >= 5, true);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length >= 5, true);
});

test("saga elimina Storage antes de finalizar DB y aborta producto si Storage falla", () => {
  assert.match(migration, /set status = 'delete_pending'/);
  assert.match(route, /storage\.from\("product-images"\)\.remove/);
  assert.ok(route.indexOf(".remove(") < route.indexOf("finalize_technical_draft_deletion"));
  assert.match(route, /if \(storageError\)[\s\S]*fail_technical_draft_storage_deletion[\s\S]*El producto no fue eliminado/);
  assert.match(migration, /delete from public\.product_images[\s\S]*delete from public\.product_slug_registry[\s\S]*delete from public\.products/);
});

test("slug finalizado retira solo registry técnico actual y nunca historial", () => {
  assert.match(migration, /registry\.product_id = p_product_id[\s\S]*registry\.is_current[\s\S]*registry\.slug = selected_product\.slug/);
  assert.doesNotMatch(migration, /delete from public\.product_slug_history/i);
  assert.match(migration, /slug_history_count <> 0/);
});

test("idempotencia conserva tombstone y una segunda ejecución retorna completed", () => {
  assert.match(migration, /product_id uuid not null unique/);
  assert.match(migration, /existing_job\.status = 'completed'[\s\S]*'status', 'completed'/);
  assert.match(migration, /selected_job\.status = 'completed'[\s\S]*'idempotent', true/);
  assert.match(route, /prepared\.status === "completed"[\s\S]*idempotent: true/);
});

test("race entre lectura y borrado se detecta con lock y revalidación final", () => {
  assert.equal((migration.match(/pg_catalog\.pg_advisory_xact_lock/g) ?? []).length, 2);
  assert.equal((migration.match(/for update/g) ?? []).length >= 4, true);
  assert.equal((migration.match(/technical_draft_deletion_snapshot\(p_product_id\)/g) ?? []).length >= 3, true);
  assert.match(migration, /Technical draft eligibility changed/);
  assert.match(route, /status: 409/);
});

test("saga técnica conserva su UI legacy mientras el formulario usa gestión general", () => {
  assert.match(form, /ProductManagementPanel productId=\{product\.id\}/);
  assert.match(button, /body\?\.eligibility\?\.eligible === true/);
  assert.match(button, /Este borrador técnico se eliminará definitivamente\. Esta acción no se puede deshacer\./);
  assert.match(button, /method: "DELETE"/);
  assert.match(button, /router\.replace\("\/productos"\)/);
});

test("handler exige sesión administrativa, same-origin y manifiesto hard-bound", () => {
  assert.match(route, /getAdministrativeSession/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /bucket !== "product-images"/);
  assert.match(route, /isProductImageStoragePath\(path, productId, imageId\)/);
  assert.doesNotMatch(route, /console\.|SUPABASE_SERVICE_ROLE_KEY|request\.json/);
});
