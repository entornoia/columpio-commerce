import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260830211510_product_photo_intake.sql", import.meta.url), "utf8");
const intake = readFileSync(new URL("../src/components/product-photo-intake.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("../src/components/product-form.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/catalog/product-analysis/route.ts", import.meta.url), "utf8");
const analysis = readFileSync(new URL("../src/lib/catalog-product-analysis.ts", import.meta.url), "utf8");
const upload = readFileSync(new URL("../src/lib/product-image-upload.ts", import.meta.url), "utf8");
const manager = readFileSync(new URL("../src/components/product-image-manager.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/app/productos/nuevo/page.tsx", import.meta.url), "utf8");
const advisor = readFileSync(new URL("../src/lib/channels/instagram/advisor-orchestrator.ts", import.meta.url), "utf8");
const publicCatalogMigration = readFileSync(new URL("../supabase/migrations/20260830033207_public_catalog_taxonomy.sql", import.meta.url), "utf8");
const advisorSearch = readFileSync(new URL("../src/lib/catalog-search.ts", import.meta.url), "utf8");

test("016 es aditiva, transaccional y preserva el catálogo existente", () => {
  assert.match(migration, /^begin;/i); assert.match(migration, /commit;\s*$/i);
  for (const column of ["setup_status", "setup_started_at", "setup_updated_at", "setup_created_by", "setup_expires_at", "analysis_status", "analysis_completed_at", "analysis_model", "analysis_error"]) assert.match(migration, new RegExp(`add column ${column}`));
  assert.doesNotMatch(migration, /drop table|drop column|truncate/i);
  assert.match(migration, /default 'complete'/);
  const backfill = migration.slice(migration.indexOf("update public.products"), migration.indexOf("create index products_setup_cleanup_idx"));
  assert.doesNotMatch(backfill, /publication_status\s*=/i);
});

test("draft técnico es inactivo, privado, sin variantes y expira en siete días", () => {
  const create = migration.slice(migration.indexOf("create or replace function public.create_product_intake_draft"), migration.indexOf("create or replace function public.begin_product_intake_analysis"));
  assert.match(create, /'technical_draft'/); assert.match(create, /false, brand_id/); assert.match(create, /'draft', null/);
  assert.match(create, /interval '7 days'/); assert.doesNotMatch(create, /product_variants/);
  assert.match(create, /revoke all[\s\S]*from public, anon/); assert.match(create, /grant execute[\s\S]*to authenticated/);
});

test("draft técnico queda invisible para storefront y advisor", () => {
  assert.match(publicCatalogMigration, /where product\.active[\s\S]*publication_status = 'published'/);
  assert.match(advisorSearch, /active/); assert.match(migration, /false, brand_id/);
});

test("SKU y slug técnicos son internos y el primer slug comercial no crea historial", () => {
  assert.match(migration, /'DRAFT-' \|\| upper\(internal_token\)/); assert.match(migration, /'draft-' \|\| internal_token/);
  assert.match(migration, /technical_slug_releasable/); assert.match(migration, /discard_internal_slug/); assert.match(migration, /delete from public\.product_slug_registry/);
  assert.match(migration, /Define SKU y slug comerciales antes de retirar el slug técnico/);
  const discardBranch = migration.slice(migration.indexOf("if found and discard_internal_slug"), migration.indexOf("elsif found then"));
  assert.doesNotMatch(discardBranch, /product_slug_history/);
});

test("precio cero no completa producto y setup complete precede ready/publicación", () => {
  assert.match(migration, /product\.price > 0/); assert.match(migration, /product\.setup_status = 'complete'/);
  assert.match(migration, /products_complete_price_check/); assert.match(migration, /products_ready_active_check/);
  assert.match(migration, /current_setup <> 'complete'/); assert.match(migration, /Solo un producto listo puede publicarse/);
  assert.match(migration, /safe_product := jsonb_set[\s\S]*publication_status[\s\S]*draft/);
  assert.match(migration, /set setup_status = 'complete'[\s\S]*set publication_status = 'ready'/);
});

test("intake permanece inactivo y sólo una ficha completa puede adoptar active solicitado", () => {
  assert.match(migration, /products_incomplete_inactive_check/);
  assert.match(migration, /safe_product := jsonb_set\(safe_product, '\{active\}', 'false'/);
  assert.match(migration, /set setup_status = 'complete', active = requested_active/);
  assert.match(migration, /set setup_status = 'in_progress', active = false/);
  assert.match(migration, /requested_status = 'ready' and requested_active/);
});

test("colores IA permanecen en UI y variantes incompletas nunca se guardan", () => {
  assert.match(intake, /suggestedColors/); assert.match(intake, /variants: \(suggestedColors\.length/);
  assert.match(migration, /Completa SKU, color, talla y stock de cada variante antes de guardar/);
  assert.match(form, /input required value=\{item\.variantSku\}/); assert.match(form, /input required value=\{item\.size\}/);
  assert.doesNotMatch(route, /product_variants|variant_sku|stock/);
});

test("seleccionar foto no crea registros y Analizar inicia el draft", () => {
  const selection = intake.slice(intake.indexOf("const selectFile"), intake.indexOf("const loadPreparedProduct"));
  assert.doesNotMatch(selection, /\.rpc\(|fetch\(|uploadProductImage/);
  const analyzeAction = intake.slice(intake.indexOf("const analyze"), intake.indexOf("if \(preparedProduct\)"));
  assert.match(analyzeAction, /create_product_intake_draft/); assert.match(analyzeAction, /uploadProductImage/);
  assert.match(page, /ProductPhotoIntake/); assert.doesNotMatch(page, /<ProductForm/);
});

test("onboarding y gestor reutilizan exactamente la saga de upload 3A", () => {
  for (const source of [intake, manager]) assert.match(source, /uploadProductImage/);
  for (const rpc of ["reserve_product_image_upload", "finalize_product_image_upload", "fail_product_image_upload"]) assert.match(upload, new RegExp(rpc));
  assert.match(upload, /upsert: false/); assert.match(upload, /PRODUCT_IMAGE_BUCKET = "product-images"/);
});

test("endpoint es autenticado, recibe IDs y rechaza imágenes ajenas", () => {
  assert.match(route, /getUser\(\)/); assert.match(route, /getClaims\(\)/); assert.match(route, /role !== "authenticated"/);
  assert.match(route, /typeof body\.productId/); assert.match(route, /typeof body\.imageId/); assert.doesNotMatch(route, /body\.imageUrl|body\.url/);
  assert.match(route, /image\.product_id !== product\.id/); assert.match(route, /image\.status !== "ready"/);
  assert.match(route, /image\.storage_bucket !== "product-images"/); assert.match(route, /hasExactPath/);
  assert.match(route, /validatedImage\.size !== image\.file_size/);
  assert.match(route, /UUID_PATTERN\.test\(body\.productId\)/); assert.match(route, /UUID_PATTERN\.test\(body\.imageId\)/);
  assert.match(route, /No se pudo analizar la prenda\. Puedes reintentar/); assert.doesNotMatch(route, /beginError\.message|completeError\.message/);
});

test("análisis usa una sola llamada visual y schema estricto separado del advisor", () => {
  assert.equal((analysis.match(/openai\.responses\.create/g) ?? []).length, 1);
  assert.match(analysis, /strict: true/); assert.match(analysis, /DEFAULT_GARMENT_VISION_MODEL/); assert.match(analysis, /validateGarmentImage/);
  assert.doesNotMatch(advisor, /analyzeCatalogProductImage|product-analysis/);
  assert.match(analysis, /timeout: 45_000/);
});

test("concurrencia bloquea doble análisis y permite sólo retry failed o processing vencido", () => {
  assert.match(intake, /disabled=\{busy/); assert.match(intake, /setBusy\(true\)/);
  assert.match(migration, /analysis_status in \('not_started', 'failed'\)/);
  assert.match(migration, /analysis_status = 'processing'[\s\S]*interval '5 minutes'/);
  assert.match(migration, /products_protect_analysis_transition/);
  assert.match(migration, /old\.analysis_status = 'failed' and new\.analysis_status = 'processing'/);
  assert.doesNotMatch(migration, /old\.analysis_status = 'completed' and new\.analysis_status/);
});

test("doble create draft reutiliza el draft vacío bajo advisory lock", () => {
  const create = migration.slice(migration.indexOf("create or replace function public.create_product_intake_draft"), migration.indexOf("create or replace function public.begin_product_intake_analysis"));
  assert.match(create, /pg_advisory_xact_lock/); assert.match(create, /setup_created_by = current_user_id/);
  assert.match(create, /not exists \(select 1 from public\.product_images/); assert.match(create, /return reusable_draft_id/);
});

test("schema no genera precio, stock, tallas ni SKU y limita categoría", () => {
  const schema = analysis.slice(analysis.indexOf("catalogProductAnalysisSchema"), analysis.indexOf("function validateSuggestion"));
  assert.doesNotMatch(schema, /price|stock|sizes|sku/i);
  for (const slug of ["vestidos", "blusas", "poleras", "pantalones", "chaquetas", "accesorios"]) assert.match(analysis, new RegExp(`"${slug}"`));
  assert.match(analysis, /CATALOG_CATEGORY_SLUGS\.includes/); assert.match(analysis, /La categoría sugerida no pertenece a la taxonomía permitida/);
});

test("mapeo conserva campos comerciales manuales y resuelve category_id server-side", () => {
  assert.match(route, /from\("categories"\)/); assert.match(route, /\.eq\("slug", categorySlug\)/);
  assert.match(intake, /price: 0/); assert.match(intake, /sku: ""/); assert.match(intake, /size: ""/); assert.match(intake, /stock: 0/);
  assert.match(intake, /categoryId: analysisResult\.resolvedCategory\?\.id/); assert.match(intake, /secondaryColors\.map\(value\)/);
  assert.match(form, /min=\{intakeMode \? 1 : 0\}/);
});

test("error IA conserva imagen, permite reintento explícito y nunca publica", () => {
  assert.match(route, /fail_product_intake_analysis/); assert.match(migration, /analysis_status = 'failed'/);
  assert.match(intake, /imageId \? "Reintentar análisis"/); assert.match(intake, /if \(!currentImageId\)/);
  assert.doesNotMatch(route, /publish_catalog_product|publication_status\s*=\s*["']published/);
  assert.match(form, /La publicación seguirá siendo una acción posterior/);
});

test("slug comercial nunca recupera la excepción técnica", () => {
  assert.match(migration, /new\.technical_slug_releasable := false/);
  assert.match(migration, /not old\.technical_slug_releasable and new\.technical_slug_releasable/);
  assert.match(migration, /Un producto comercial no puede volver al intake técnico/);
  const normalBranch = migration.slice(migration.indexOf("elsif found then"), migration.indexOf("insert into public.product_slug_registry", migration.indexOf("elsif found then")));
  assert.match(normalBranch, /product_slug_history/);
});

test("save legacy de un producto complete no altera setup ni metadata de análisis", () => {
  const save = migration.slice(migration.indexOf("create or replace function public.save_catalog_product(p_product"), migration.indexOf("create or replace function public.publish_catalog_product"));
  assert.match(save, /prior_setup_status in \('technical_draft', 'in_progress'\)/);
  assert.doesNotMatch(save, /p_product->>'setup_status'|p_product->>'analysis_status'|p_product->>'analysis_model'/);
  assert.match(migration, /old\.setup_status = 'complete' and new\.setup_status <> 'complete'/);
  assert.match(migration, /current_setting\('columpio\.complete_product_setup', true\)/);
  assert.match(save, /set_config\('columpio\.complete_product_setup', 'on', true\)/);
});

test("UX foto-first conserva preview, límites y formulario posterior", () => {
  assert.match(intake, /Sube una foto de la prenda/); assert.match(intake, /JPEG, PNG o WebP · máximo 5 MiB/);
  assert.match(intake, /Análisis completado/); assert.match(intake, /<ProductForm product=\{preparedProduct\}/);
  assert.match(intake, /Seleccionar una foto no crea registros/); assert.match(form, /ProductImageManager/);
});
