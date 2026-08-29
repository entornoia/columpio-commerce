import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatInstagramPurchaseCta, resolveInstagramPurchaseUrl } from "../src/lib/channels/instagram/purchase-cta.ts";
import { semanticActions, validateSemanticCommerceInterpretation } from "../src/lib/channels/instagram/semantic-schema.ts";
import { instagramAdvisorModeEnabled } from "../src/lib/channels/instagram/semantic-interpreter.ts";

const originalMode = process.env.INSTAGRAM_COMMERCE_MODE;
const originalStore = process.env.STORE_WEB_URL;
test.afterEach(() => {
  if (originalMode === undefined) delete process.env.INSTAGRAM_COMMERCE_MODE; else process.env.INSTAGRAM_COMMERCE_MODE = originalMode;
  if (originalStore === undefined) delete process.env.STORE_WEB_URL; else process.env.STORE_WEB_URL = originalStore;
});

test("solo advisor habilita el modo comercial de Instagram", () => {
  for (const value of [undefined, "transactional", "true", "ADVISOR"]) {
    if (value === undefined) delete process.env.INSTAGRAM_COMMERCE_MODE; else process.env.INSTAGRAM_COMMERCE_MODE = value;
    assert.equal(instagramAdvisorModeEnabled(), false);
  }
  process.env.INSTAGRAM_COMMERCE_MODE = "advisor";
  assert.equal(instagramAdvisorModeEnabled(), true);
});

test("schema advisor contiene únicamente acciones de asesoría y rutas sensibles", () => {
  assert.deepEqual(semanticActions, ["search_product", "recommend_complement", "ask_product_attribute", "purchase_cta", "after_sales", "exchange_return", "order_tracking", "human_request", "clarify"]);
  for (const action of ["add_to_cart", "set_cart_quantity", "remove_from_cart", "create_order", "create_payment_link", "select_variant", "set_quantity", "review_selection", "checkout"]) {
    assert.equal(validateSemanticCommerceInterpretation({ action }), null);
  }
});

test("CTA usa exclusivamente STORE_WEB_URL HTTPS permitido", () => {
  process.env.STORE_WEB_URL = "https://columpiostore.cl";
  assert.equal(resolveInstagramPurchaseUrl(), "https://columpiostore.cl");
  assert.equal(formatInstagramPurchaseCta(), "Perfecto 💛 Puedes comprarla directamente en nuestra tienda online: https://columpiostore.cl");
});

test("CTA rechaza HTTP, dominios externos y URLs generadas", () => {
  for (const value of ["http://columpiostore.cl", "https://evil.example", "javascript:alert(1)", "no-es-url"]) {
    process.env.STORE_WEB_URL = value;
    assert.equal(resolveInstagramPurchaseUrl(), null);
  }
});

test("URL canónica validada tiene prioridad y nunca construye slugs", () => {
  process.env.STORE_WEB_URL = "https://columpiostore.cl";
  assert.equal(resolveInstagramPurchaseUrl({ canonicalUrl: "https://www.columpiostore.cl/productos/amelia" }), "https://www.columpiostore.cl/productos/amelia");
  assert.equal(resolveInstagramPurchaseUrl({ canonicalUrl: "https://otro.example/amelia" }), "https://columpiostore.cl");
});

test("advisor no importa ni tiene acceso a comercio transaccional o Flow", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/advisor-orchestrator.ts", import.meta.url), "utf8");
  for (const forbidden of ["executeCommerceTool", "loadCommerceSnapshot", "add_to_cart", "set_cart_quantity", "remove_from_cart", "create_order", "create_payment_link", "payerEmail", "Flow"]) assert.doesNotMatch(source, new RegExp(forbidden));
});

test("processor entra a advisor y no habilita rollback transaccional", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  assert.match(source, /if \(instagramAdvisorModeEnabled\(\)\)[\s\S]*runInstagramAdvisor/);
  assert.match(source, /La asesoría automática de productos no está disponible/);
  assert.doesNotMatch(source.split("/* Flujo transaccional")[0], /executeCommerceTool|loadCommerceSnapshot|create_payment_link/);
});

test("advisor usa Supabase para búsqueda, atributos y recomendaciones sin mutar foco al recomendar", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/advisor-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /searchSemanticCatalog/);
  assert.match(source, /formatAttribute/);
  const recommendation = source.slice(source.indexOf('interpretation.action === "recommend_complement"'));
  assert.match(recommendation, /searched\.results/);
  assert.doesNotMatch(recommendation, /setInstagramSemanticFocus/);
});

test("handoff sigue delegado al backend y la ambigüedad solo aclara", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/advisor-orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /handoffIntent/);
  assert.match(source, /confidence < 0\.75[\s\S]*action: "clarify"/);
  assert.doesNotMatch(source, /transitionToTemporaryHuman|pauseTemporarily/);
});
