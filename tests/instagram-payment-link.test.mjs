import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeCommerceTool } from "../src/lib/commerce/tools.ts";
import { formatCommerceResponse } from "../src/lib/commerce/response-formatter.ts";
import { createMercadoPagoGateway, MercadoPagoRequestError } from "../src/lib/payments/mercadopago.ts";

process.env.MERCADOPAGO_ACCESS_TOKEN = "TEST_ACCESS_TOKEN_NOT_REAL";
process.env.MERCADOPAGO_ENVIRONMENT = "test";
process.env.APP_BASE_URL = "https://columpio-commerce.vercel.app";

const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claimId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claimToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const item = { orderItemId: "item-1", productId: "product-1", variantId: "11111111-1111-4111-8111-111111111111", productName: "Blazer Emilia", productSku: "CHA-001", variantSku: "CHA-001-NEG-M", color: "Negro", size: "M", quantity: 2, unitPrice: 54990, subtotal: 109980 };

function fixture({ orderError = null, order = {}, preference = null, gateway } = {}) {
  const snapshot = { status: "payment_link_claimed", claimOwned: true, claimId, claimToken, orderId, orderNumber: "COL-100001", orderStatus: "pending_payment", currency: "CLP", subtotal: 109980, total: 109980, items: [item], ...order };
  const state = { preference, rpcCalls: [], gatewayCreates: 0, gatewayFinds: 0, stock: 5, orderStatus: snapshot.orderStatus };
  const defaultGateway = {
    async findPreference() { state.gatewayFinds += 1; return null; },
    async createPreference(payload) { state.gatewayCreates += 1; state.payload = payload; return { id: "pref-new", initPoint: "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=new", sandboxInitPoint: "https://sandbox.mercadopago.cl/new" }; },
  };
  const selectedGateway = gateway?.(state) ?? defaultGateway;
  const supabase = { async rpc(name, args) {
    state.rpcCalls.push({ name, args });
    if (name === "claim_mercadopago_preference") {
      if (orderError) return { data: null, error: { message: orderError } };
      if (state.preference?.status === "ready") return { data: { ...snapshot, status: "payment_link_ready", claimOwned: false, preferenceId: state.preference.id, paymentUrl: state.preference.url, sandboxPaymentUrl: null }, error: null };
      if (state.preference?.status === "creating") return { data: { ...snapshot, status: "payment_link_processing", claimOwned: false, claimToken: null }, error: null };
      state.preference = { status: "creating" };
      return { data: snapshot, error: null };
    }
    if (name === "complete_mercadopago_preference") {
      state.preference = { status: "ready", id: args.p_preference_id, url: args.p_init_point };
      return { data: { status: "payment_link_ready", preferenceId: args.p_preference_id, paymentUrl: args.p_init_point, sandboxPaymentUrl: args.p_sandbox_init_point }, error: null };
    }
    if (name === "fail_mercadopago_preference") { state.preference = { status: "failed", code: args.p_error_code }; return { data: null, error: null }; }
    return { data: null, error: { message: `RPC inesperada: ${name}` } };
  } };
  return { state, context: { supabase, externalUserId: "ig-user", eventId: "mid-payment", authorizeMutation: async () => undefined, paymentGateway: selectedGateway } };
}

test("la migración 008 crea persistencia, RLS, unicidad y RPC SECURITY INVOKER", async () => {
  const sql = await readFile(new URL("../supabase/migrations/008_mercadopago_checkout_pro.sql", import.meta.url), "utf8");
  for (const token of ["commerce_payment_preferences", "unique (provider, order_id)", "claim_mercadopago_preference", "complete_mercadopago_preference", "fail_mercadopago_preference", "enable row level security", "service_role", "security invoker"]) assert.match(sql.toLowerCase(), new RegExp(token.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(sql, /security definer/i);
});

test("pedido inexistente, carrito sin pedido, cancelado y no pending no generan link", async () => {
  const cases = [["Order not found", "order_not_found"], ["Order not found", "order_not_found"], ["Order cancelled", "order_cancelled"], ["Order is not pending payment", "order_not_pending"]];
  for (const [error, code] of cases) {
    const f = fixture({ orderError: error });
    const result = await executeCommerceTool(f.context, "create_payment_link", {});
    assert.equal(result.code, code); assert.equal(f.state.gatewayCreates, 0);
  }
});

test("MERCADOPAGO_ENVIRONMENT ausente o inválido bloquea incluso la reutilización", async () => {
  const previous = process.env.MERCADOPAGO_ENVIRONMENT;
  for (const value of [undefined, "sandbox", "TRUE"]) {
    if (value === undefined) delete process.env.MERCADOPAGO_ENVIRONMENT; else process.env.MERCADOPAGO_ENVIRONMENT = value;
    const f = fixture({ preference: { status: "ready", id: "pref-existing", url: "https://www.mercadopago.cl/existing" } });
    await assert.rejects(executeCommerceTool(f.context, "create_payment_link", {}), /MERCADOPAGO_ENVIRONMENT/);
    assert.equal(f.state.rpcCalls.length, 0);
  }
  process.env.MERCADOPAGO_ENVIRONMENT = previous;
});

test("cantidades mayores a uno y snapshots se copian literalmente al payload", async () => {
  const f = fixture();
  await executeCommerceTool(f.context, "create_payment_link", {});
  assert.deepEqual(f.state.payload.items, [{ id: item.variantId, title: item.productName, description: "Negro · talla M · SKU CHA-001-NEG-M · producto CHA-001", currency_id: "CLP", quantity: 2, unit_price: 54990 }]);
  assert.equal(f.state.payload.external_reference, orderId);
  assert.equal(f.state.payload.statement_descriptor, "COLUMPIO");
  assert.deepEqual(f.state.payload.metadata, { order_id: orderId, order_number: "COL-100001", channel: "instagram" });
});

test("importes, cantidades, moneda y estado inconsistentes fallan antes de Mercado Pago", async () => {
  const invalid = [
    { subtotal: 1 }, { total: 1 }, { currency: "USD" }, { orderStatus: "cancelled" },
    { items: [{ ...item, quantity: 0, subtotal: 0 }], subtotal: 0, total: 0 },
    { items: [{ ...item, unitPrice: 54991 }] },
  ];
  for (const order of invalid) {
    const f = fixture({ order });
    await assert.rejects(executeCommerceTool(f.context, "create_payment_link", {}), /Preferencia de pago inconsistente/);
    assert.equal(f.state.gatewayCreates, 0);
  }
});

test("una preference nueva persiste literalmente id e init_point", async () => {
  const f = fixture();
  const result = await executeCommerceTool(f.context, "create_payment_link", {});
  assert.equal(result.preferenceId, "pref-new");
  assert.equal(result.paymentUrl, "https://www.mercadopago.cl/checkout/v1/redirect?pref_id=new");
  assert.equal(f.state.preference.url, result.paymentUrl);
});

test("una preference ready se reutiliza sin consultar ni crear en Mercado Pago", async () => {
  const url = "https://www.mercadopago.cl/existing";
  const f = fixture({ preference: { status: "ready", id: "pref-existing", url } });
  const result = await executeCommerceTool(f.context, "create_payment_link", {});
  assert.equal(result.paymentUrl, url); assert.equal(f.state.gatewayCreates, 0); assert.equal(f.state.gatewayFinds, 0);
});

test("dos solicitudes concurrentes no crean dos preferences", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ gateway: (state) => ({
    async findPreference() { state.gatewayFinds += 1; return null; },
    async createPreference(payload) { state.gatewayCreates += 1; state.payload = payload; await gate; return { id: "pref-one", initPoint: "https://www.mercadopago.cl/one", sandboxInitPoint: null }; },
  }) });
  const first = executeCommerceTool(f.context, "create_payment_link", {});
  await new Promise((resolve) => setImmediate(resolve));
  const second = await executeCommerceTool(f.context, "create_payment_link", {});
  assert.equal(second.code, "payment_link_processing");
  release(); await first;
  assert.equal(f.state.gatewayCreates, 1);
});

test("un timeout incierto reconcilia por external_reference antes de crear otra", async () => {
  let searches = 0;
  const f = fixture({ gateway: (state) => ({
    async findPreference(reference) { state.gatewayFinds += 1; searches += 1; assert.equal(reference, orderId); return searches === 1 ? null : { id: "pref-reconciled", initPoint: "https://www.mercadopago.cl/reconciled", sandboxInitPoint: null }; },
    async createPreference() { state.gatewayCreates += 1; throw new MercadoPagoRequestError("timeout", "network_error", true); },
  }) });
  const result = await executeCommerceTool(f.context, "create_payment_link", {});
  assert.equal(result.preferenceId, "pref-reconciled"); assert.equal(f.state.gatewayCreates, 1); assert.equal(f.state.gatewayFinds, 2);
});

test("el cliente usa el endpoint único y reconcilia la respuesta oficial elements", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (init.method === "GET") return new Response(JSON.stringify({ elements: [{ id: "pref-found", external_reference: orderId, init_point: "https://www.mercadopago.cl/found", sandbox_init_point: null }], next_offset: 1, total: 1 }), { status: 200 });
    return new Response(JSON.stringify({ id: "pref-created", init_point: "https://www.mercadopago.cl/created", sandbox_init_point: "https://sandbox.mercadopago.cl/created" }), { status: 201 });
  };
  try {
    const gateway = createMercadoPagoGateway();
    const found = await gateway.findPreference(orderId);
    const created = await gateway.createPreference({ items: [{ id: item.variantId, title: item.productName, description: item.variantSku, currency_id: "CLP", quantity: 2, unit_price: 54990 }], statement_descriptor: "COLUMPIO", external_reference: orderId, metadata: { order_id: orderId, order_number: "COL-100001", channel: "instagram" }, back_urls: { success: "https://example.com/s", pending: "https://example.com/p", failure: "https://example.com/f" }, auto_return: "approved" });
    assert.equal(found.id, "pref-found"); assert.equal(created.id, "pref-created");
    assert.match(requests[0].url, /^https:\/\/api\.mercadopago\.com\/checkout\/preferences\/search\?/);
    assert.equal(new URL(requests[0].url).searchParams.get("external_reference"), orderId);
    assert.equal(requests[1].url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal(JSON.parse(requests[1].init.body).items[0].quantity, 2);
    assert.equal(JSON.parse(requests[1].init.body).statement_descriptor, "COLUMPIO");
  } finally { globalThis.fetch = originalFetch; }
});

test("la URL es determinista y el modelo no puede suministrarla ni alterarla", async () => {
  const f = fixture();
  await assert.rejects(executeCommerceTool(f.context, "create_payment_link", { paymentUrl: "https://evil.example" }), /Campos comerciales inválidos/);
  const message = formatCommerceResponse("create_payment_link", { status: "payment_link_ready", orderNumber: "COL-100001", paymentUrl: "https://www.mercadopago.cl/literal" }, {});
  assert.equal(message, "Perfecto 💛 tu pedido COL-100001 está listo. Puedes pagarlo aquí: https://www.mercadopago.cl/literal");
});

test("kill switch y handoff impiden reclamar o crear la preference", async () => {
  for (const reason of ["global_disabled", "human_only", "temporary_human"]) {
    const f = fixture(); f.context.authorizeMutation = async () => { throw new Error(reason); };
    await assert.rejects(executeCommerceTool(f.context, "create_payment_link", {}), new RegExp(reason));
    assert.equal(f.state.rpcCalls.length, 0); assert.equal(f.state.gatewayCreates, 0);
  }
});

test("crear el link no modifica pedido ni stock", async () => {
  const f = fixture(); const before = { stock: f.state.stock, orderStatus: f.state.orderStatus };
  await executeCommerceTool(f.context, "create_payment_link", {});
  assert.deepEqual({ stock: f.state.stock, orderStatus: f.state.orderStatus }, before);
});

test("payment-result es pública e informativa y no modifica estados", async () => {
  const proxy = await readFile(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/payment-result/page.tsx", import.meta.url), "utf8");
  assert.match(proxy, /"\/payment-result"/);
  assert.match(page, /Este resultado es informativo/);
  assert.doesNotMatch(page, /supabase|update\(|paid_at/i);
});
