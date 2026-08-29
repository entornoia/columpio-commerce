import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isFocusFresh } from "../src/lib/channels/instagram/focus-repository.ts";
import { semanticCommerceJsonSchema, validateSemanticCommerceInterpretation } from "../src/lib/channels/instagram/semantic-schema.ts";
import { normalizeSemanticCatalogSearch } from "../src/lib/channels/instagram/catalog-normalizer.ts";
import { filterCatalogProducts } from "../src/lib/catalog-search.ts";

const valid = (overrides = {}) => ({
  action: "search_product",
  reference: { kind: "explicit", product_name: "Blazer Emilia", category: null, color: "Negro", size: null },
  target: { category: "Chaquetas", color: "Negro", size: null, quantity: null },
  attribute: null, confidence: 0.98, needs_clarification: false, reason_code: "explicit_search", ...overrides,
});

test("schema semántico acepta búsqueda sin convertir nombres en IDs", () => {
  const result = validateSemanticCommerceInterpretation(valid());
  assert.equal(result?.action, "search_product");
  assert.equal(result?.reference.productName, "Blazer Emilia");
  assert.equal("productId" in result.reference, false);
});

test("schema rechaza acciones y reason_code fuera del contrato", () => {
  assert.equal(validateSemanticCommerceInterpretation(valid({ action: "add_to_cart" })), null);
  assert.equal(validateSemanticCommerceInterpretation(valid({ reason_code: "precio_54990" })), null);
});

test("schema rechaza cantidad fuera del límite comercial", () => {
  assert.equal(validateSemanticCommerceInterpretation(valid({ target: { category: null, color: null, size: "M", quantity: 21 } })), null);
});

test("JSON Schema prohíbe campos extra monetarios o identificadores", () => {
  assert.equal(semanticCommerceJsonSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(semanticCommerceJsonSchema.properties).sort(), ["action", "attribute", "confidence", "needs_clarification", "reason_code", "reference", "target"]);
});

test("foco válido puede resolver pronombres dentro de 30 minutos", () => {
  assert.equal(isFocusFresh({ productId: "p", variantId: null, category: "Chaquetas", updatedAt: "2026-08-29T10:00:00.000Z" }, "2026-08-29T10:29:59.000Z"), true);
});

test("foco vencido no puede respaldar una mutación pronominal", () => {
  assert.equal(isFocusFresh({ productId: "p", variantId: null, category: "Chaquetas", updatedAt: "2026-08-29T10:00:00.000Z" }, "2026-08-29T10:30:01.000Z"), false);
});

test("migración 013 mantiene foco y selección separados y usa SECURITY INVOKER", async () => {
  const sql = await readFile(new URL("../supabase/migrations/013_instagram_semantic_focus.sql", import.meta.url), "utf8");
  assert.match(sql, /focus_product_id uuid/);
  assert.match(sql, /focus_variant_id uuid/);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /commerce_cart_items\s+(set|update|delete|insert)/i);
  assert.doesNotMatch(sql, /last_product_id\s*=\s*focus_product_id|focus_product_id\s*=\s*last_product_id/i);
});

test("processor usa 3A.5 sin fallback silencioso a 3A.4 cuando el flag está activo", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  const semantic = source.indexOf("if (semanticCommerceOrchestratorEnabled())");
  const legacy = source.indexOf("const focusedProduct =");
  assert.ok(semantic > 0 && legacy > semantic);
  assert.match(source.slice(semantic, legacy), /return \{ responseText: semantic\.responseText/);
});

test("recomendación consulta catálogo y no ejecuta tool comercial", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/commercial-orchestrator.ts", import.meta.url), "utf8");
  const start = source.indexOf('if (interpretation.action === "recommend_complement") {');
  const end = source.indexOf('interpretation.action === "select_product"', start);
  const branch = source.slice(start, end);
  assert.match(branch, /searchCatalog/);
  assert.doesNotMatch(branch, /executeCommerceTool|setInstagramSemanticFocus/);
});

test("review y checkout se resuelven desde snapshot, no desde foco", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/commercial-orchestrator.ts", import.meta.url), "utf8");
  const review = source.slice(source.indexOf('interpretation.action === "review_selection"'), source.indexOf('interpretation.action === "checkout"'));
  assert.match(review, /snapshot\.latestOrder|snapshot\.selection/);
  assert.doesNotMatch(review, /focus\./);
  const checkout = source.slice(source.indexOf('interpretation.action === "checkout"'), source.indexOf("const requiresFreshFocus"));
  assert.match(checkout, /resolveCommerceAction\("pay", snapshot/);
  assert.doesNotMatch(checkout, /focus\./);
});

test("mutaciones usan solo variantId resuelto server-side", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/commercial-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /const variant = resolved\.value\.variant/);
  assert.match(source, /const input = \{ variantId: variant\.id, quantity:/);
  assert.doesNotMatch(source, /interpretation\.(productId|variantId|price|stock|paymentUrl)/);
});

test("ambigüedad no crea handoff ni mutación", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/commercial-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /confidence < 0\.75[\s\S]*action: "clarify", mutated: false/);
  assert.doesNotMatch(source, /transitionToTemporaryHuman|pauseTemporarily/);
});

const product = (values) => ({ id: values.name, sku: values.name, description: "", style: "", season: "", formality: "", fit: "", material: "", occasions: [], createdAt: "", updatedAt: "", images: [], active: true, ...values });
const catalog = [
  product({ name: "Blusa Amelia", category: "Tops", subcategory: "Blusas", price: 32990, variants: [{ id: "amelia-s", variantSku: "A-S", color: "Marfil", size: "S", stock: 3, active: true }, { id: "amelia-m", variantSku: "A-M", color: "Marfil", size: "M", stock: 2, active: true }] }),
  product({ name: "Blazer Emilia", category: "Chaquetas", subcategory: "Blazers", price: 54990, variants: [{ id: "emilia-s", variantSku: "E-S", color: "Negro", size: "S", stock: 2, active: true }] }),
  product({ name: "Pantalón Renata", category: "Pantalones", subcategory: "Sastreros", price: 42990, variants: [{ id: "renata-m", variantSku: "R-M", color: "Negro", size: "M", stock: 2, active: true }] }),
];

function normalizedResults(category, color, products = catalog) {
  const normalized = normalizeSemanticCatalogSearch({ productName: null, referenceCategory: category, targetCategory: category, referenceColor: color, targetColor: color });
  return { normalized, results: filterCatalogProducts(products, normalized.primaryFilters) };
}

test("blusa marfil y una blusa color marfil encuentran Blusa Amelia", () => {
  assert.deepEqual(normalizedResults("blusa", "marfil").results.map((item) => item.name), ["Blusa Amelia"]);
  assert.deepEqual(normalizedResults("Blusas", "Marfil").results.map((item) => item.name), ["Blusa Amelia"]);
});

test("blazer negro encuentra Blazer Emilia aunque el intérprete traduzca black", () => {
  assert.deepEqual(normalizedResults("blazer", "negro").results.map((item) => item.name), ["Blazer Emilia"]);
  assert.deepEqual(normalizedResults("Blazers", "black").results.map((item) => item.name), ["Blazer Emilia"]);
});

test("pantalón negro encuentra Renata y tolera singular, plural, mayúsculas y tildes", () => {
  for (const category of ["pantalón", "pantalones", "PANTALON", "Pantalones"]) assert.deepEqual(normalizedResults(category, "NEGRO").results.map((item) => item.name), ["Pantalón Renata"]);
});

test("color inexistente conserva el filtro y no devuelve producto falso", () => {
  const { normalized, results } = normalizedResults("blusa", "verde fluorescente");
  assert.equal(normalized.primaryFilters.color, "verde fluorescente");
  assert.equal(results.length, 0);
});

test("productos inactivos no aparecen", () => {
  const inactive = catalog.map((item) => item.name === "Blusa Amelia" ? { ...item, active: false } : item);
  assert.equal(normalizedResults("blusa", "marfil", inactive).results.length, 0);
});

test("stock cero respeta inStock=true y no se anuncia disponible", () => {
  const zero = catalog.map((item) => item.name === "Blusa Amelia" ? { ...item, variants: item.variants.map((variant) => ({ ...variant, stock: 0 })) } : item);
  assert.equal(normalizedResults("blusa", "marfil", zero).results.length, 0);
});

test("búsqueda explícita no incluye selección ni foco como filtros", () => {
  const normalized = normalizeSemanticCatalogSearch({ productName: null, referenceCategory: "blazer", targetCategory: "blazer", referenceColor: "negro", targetColor: "negro" });
  assert.deepEqual(normalized.primaryFilters, { color: "Negro", active: true, inStock: true, category: "Chaquetas", subcategory: "Blazers" });
  assert.equal("productId" in normalized.primaryFilters, false);
  assert.equal("variantId" in normalized.primaryFilters, false);
});
