import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeCommerceTool } from "../src/lib/commerce/tools.ts";
import { formatCommerceResponse } from "../src/lib/commerce/response-formatter.ts";
import { createFlowGateway, flowCallbackUrls, FlowRequestError, signFlowParameters } from "../src/lib/payments/flow.ts";

process.env.FLOW_API_KEY = "TEST_FLOW_API_KEY_NOT_REAL";
process.env.FLOW_SECRET_KEY = "TEST_FLOW_SECRET_NOT_REAL";
process.env.FLOW_API_BASE_URL = "https://sandbox.flow.cl/api";
process.env.FLOW_ENVIRONMENT = "sandbox";
process.env.APP_BASE_URL = "https://badge-outpost-chaplain.ngrok-free.dev";

const orderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claimId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const claimToken = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const item = { orderItemId: "item-1", productId: "product-1", variantId: "11111111-1111-4111-8111-111111111111", productName: "Blazer Emilia", productSku: "CHA-001", variantSku: "CHA-001-NEG-M", color: "Negro", size: "M", quantity: 2, unitPrice: 54990, subtotal: 109980 };

function fixture({ orderError = null, order = {}, checkout = null, gateway, selectedOrderId = orderId } = {}) {
  const snapshot = { status: "payment_link_claimed", claimOwned: true, claimId, claimToken, orderId: selectedOrderId, orderNumber: selectedOrderId === orderId ? "COL-100001" : "COL-100002", orderStatus: "pending_payment", currency: "CLP", subtotal: 109980, total: 109980, items: [item], ...order };
  const state = { checkout, rpcCalls: [], gatewayCreates: 0, gatewayFinds: 0, stock: 5, orderStatus: snapshot.orderStatus };
  const defaultGateway = {
    async findByCommerceOrder() { state.gatewayFinds += 1; return null; },
    async createPayment(payload) { state.gatewayCreates += 1; state.payload = payload; return { flowOrder: 8765456, token: "FLOWTOKEN123", paymentUrl: "https://sandbox.flow.cl/app/web/pay.php?token=FLOWTOKEN123" }; },
    async getStatus() { throw new Error("no esperado"); },
  };
  const selectedGateway = gateway?.(state) ?? defaultGateway;
  const supabase = { async rpc(name, args) {
    state.rpcCalls.push({ name, args });
    if (name === "claim_flow_checkout") {
      if (orderError) return { data: null, error: { message: orderError } };
      if (!state.checkout) {
        if (!args.p_payer_email) return { data: { ...snapshot, status: "payer_email_required", claimOwned: false, claimId: null, claimToken: null }, error: null };
        state.checkout = { status: "creating", payerEmail: args.p_payer_email };
        return { data: { ...snapshot, payerEmail: args.p_payer_email }, error: null };
      }
      if (state.checkout.status === "ready") return { data: { ...snapshot, status: "payment_link_ready", claimOwned: false, claimToken: null, payerEmail: state.checkout.payerEmail, flowOrder: state.checkout.flowOrder, flowToken: state.checkout.token, paymentUrl: state.checkout.url }, error: null };
      if (state.checkout.status === "uncertain") return { data: { ...snapshot, status: "payment_link_uncertain", claimOwned: false, claimToken: null, payerEmail: state.checkout.payerEmail }, error: null };
      return { data: { ...snapshot, status: "payment_link_processing", claimOwned: false, claimToken: null, payerEmail: state.checkout.payerEmail }, error: null };
    }
    if (name === "complete_flow_checkout") {
      state.checkout = { status: "ready", payerEmail: state.checkout.payerEmail, flowOrder: args.p_flow_order, token: args.p_flow_token, url: args.p_payment_url };
      return { data: { status: "payment_link_ready", flowOrder: args.p_flow_order, flowToken: args.p_flow_token, paymentUrl: args.p_payment_url, payerEmail: state.checkout.payerEmail }, error: null };
    }
    if (name === "fail_flow_checkout") { state.checkout = { ...state.checkout, status: args.p_uncertain ? "uncertain" : "failed", code: args.p_error_code }; return { data: null, error: null }; }
    return { data: null, error: { message: `RPC inesperada: ${name}` } };
  } };
  return { state, context: { supabase, externalUserId: "ig-user", eventId: "mid-payment", authorizeMutation: async () => undefined, flowGateway: selectedGateway } };
}

test("firma Flow usa orden alfabético, concatenación sin separadores y HMAC-SHA256", () => {
  assert.equal(signFlowParameters({ apiKey: "XXXX-XXXX-XXXX", currency: "CLP", amount: 5000 }, "my secret"), "dc3f67215dc89404aedc1deed0be7c2b49d810ca1a6e3feab3b799d77c4a9950");
});

test("011 crea persistencia Flow, RLS, claim y RPC SECURITY INVOKER", async () => {
  const sql = await readFile(new URL("../supabase/migrations/011_flow_checkout.sql", import.meta.url), "utf8");
  for (const token of ["commerce_flow_checkouts", "unique (provider, order_id)", "claim_flow_checkout", "complete_flow_checkout", "fail_flow_checkout", "uncertain", "enable row level security", "service_role", "security invoker"]) assert.match(sql.toLowerCase(), new RegExp(token.replace(/[()]/g, "\\$&")));
  assert.doesNotMatch(sql, /security definer/i); assert.doesNotMatch(sql, /update public\.products|update public\.product_variants/i);
});

test("sin email o con email inválido pide correo y no llama Flow", async () => {
  for (const payerEmail of [null, "no-es-email", "cliente@sin-dominio"]) {
    const f = fixture();
    const result = await executeCommerceTool(f.context, "create_payment_link", { payerEmail });
    assert.equal(result.customerMessage, "Perfecto 💛 Para generar tu link de pago necesito tu correo. ¿Me lo compartes?");
    assert.equal(f.state.gatewayCreates, 0); assert.equal(f.state.gatewayFinds, 0);
  }
});

test("email válido crea checkout y payload exacto desde el pedido", async () => {
  const f = fixture();
  const result = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "CLIENTA@EXAMPLE.COM" });
  assert.equal(result.paymentUrl, "https://sandbox.flow.cl/app/web/pay.php?token=FLOWTOKEN123");
  assert.deepEqual(f.state.payload, {
    commerceOrder: orderId, subject: "Pedido COL-100001", currency: "CLP", amount: 109980,
    email: "clienta@example.com", paymentMethod: 9,
    urlConfirmation: "https://badge-outpost-chaplain.ngrok-free.dev/api/payments/flow/confirmation",
    urlReturn: "https://badge-outpost-chaplain.ngrok-free.dev/api/payments/flow/return",
    optional: JSON.stringify({ orderId, orderNumber: "COL-100001", channel: "instagram" }),
  });
  assert.equal(item.quantity, 2); assert.equal(f.state.gatewayCreates, 1);
});

test("APP_BASE_URL construye callbacks locales y Vercel sin hardcode interno", () => {
  const previous = process.env.APP_BASE_URL;
  try {
    process.env.APP_BASE_URL = "https://badge-outpost-chaplain.ngrok-free.dev";
    assert.deepEqual(flowCallbackUrls(), { urlConfirmation: "https://badge-outpost-chaplain.ngrok-free.dev/api/payments/flow/confirmation", urlReturn: "https://badge-outpost-chaplain.ngrok-free.dev/api/payments/flow/return" });
    process.env.APP_BASE_URL = "https://columpio-commerce.vercel.app";
    assert.deepEqual(flowCallbackUrls(), { urlConfirmation: "https://columpio-commerce.vercel.app/api/payments/flow/confirmation", urlReturn: "https://columpio-commerce.vercel.app/api/payments/flow/return" });
  } finally { process.env.APP_BASE_URL = previous; }
});

test("ambiente, base URL, API key y secret faltantes fallan de forma cerrada", async () => {
  const saved = { ...process.env };
  try {
    for (const mutate of [
      () => { delete process.env.FLOW_API_KEY; },
      () => { delete process.env.FLOW_SECRET_KEY; },
      () => { process.env.FLOW_ENVIRONMENT = "test"; },
      () => { process.env.FLOW_API_BASE_URL = "https://www.flow.cl/api"; },
    ]) {
      Object.assign(process.env, saved); mutate();
      await assert.rejects(executeCommerceTool(fixture().context, "create_payment_link", { payerEmail: "clienta@example.com" }), /FLOW_/);
    }
  } finally { Object.assign(process.env, saved); }
});

test("cliente Flow envía form-urlencoded firmado y construye link oficial", async () => {
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("getStatusByCommerceId")) return new Response(JSON.stringify({}), { status: 400 });
    return new Response(JSON.stringify({ url: "https://sandbox.flow.cl/app/web/pay.php", token: "ABC123", flowOrder: 12345 }), { status: 200 });
  };
  try {
    const gateway = createFlowGateway();
    assert.equal(await gateway.findByCommerceOrder(orderId), null);
    const checkout = await gateway.createPayment({ commerceOrder: orderId, subject: "Pedido COL-100001", currency: "CLP", amount: 109980, email: "clienta@example.com", paymentMethod: 9, urlConfirmation: "https://example.com/c", urlReturn: "https://example.com/r", optional: "{}" });
    assert.equal(checkout.paymentUrl, "https://sandbox.flow.cl/app/web/pay.php?token=ABC123");
    assert.equal(requests[1].url, "https://sandbox.flow.cl/api/payment/create");
    assert.equal(requests[1].init.headers["Content-Type"], "application/x-www-form-urlencoded");
    const body = new URLSearchParams(requests[1].init.body); assert.equal(body.get("amount"), "109980"); assert.equal(body.get("paymentMethod"), "9"); assert.match(body.get("s"), /^[a-f0-9]{64}$/);
  } finally { globalThis.fetch = originalFetch; }
});

test("checkout ready reutiliza mismo email y link sin crear otra orden", async () => {
  const f = fixture({ checkout: { status: "ready", payerEmail: "primera@example.com", flowOrder: 10, token: "SAME", url: "https://sandbox.flow.cl/pay?token=SAME" } });
  const result = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: null });
  assert.equal(result.paymentUrl, "https://sandbox.flow.cl/pay?token=SAME"); assert.equal(f.state.gatewayCreates, 0); assert.equal(f.state.gatewayFinds, 0);
});

test("un segundo pedido puede persistir otro email", async () => {
  const secondId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; const f = fixture({ selectedOrderId: secondId });
  await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "otra@example.com" });
  assert.equal(f.state.checkout.payerEmail, "otra@example.com"); assert.equal(f.state.payload.commerceOrder, secondId);
});

test("dos solicitudes concurrentes no crean dos pagos Flow", async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture({ gateway: (state) => ({
    async findByCommerceOrder() { state.gatewayFinds += 1; return null; },
    async createPayment(payload) { state.gatewayCreates += 1; state.payload = payload; await gate; return { flowOrder: 11, token: "ONE", paymentUrl: "https://sandbox.flow.cl/pay?token=ONE" }; },
    async getStatus() { throw new Error("no esperado"); },
  }) });
  const first = executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" });
  assert.equal(second.code, "payment_link_processing"); release(); await first; assert.equal(f.state.gatewayCreates, 1);
});

test("timeout reconcilia y queda uncertain sin crear una segunda orden", async () => {
  let finds = 0;
  const f = fixture({ gateway: (state) => ({
    async findByCommerceOrder() { state.gatewayFinds += 1; finds += 1; return finds === 1 ? null : { flowOrder: 77, commerceOrder: orderId, status: 1, currency: "CLP", amount: 109980, payer: "clienta@example.com" }; },
    async createPayment() { state.gatewayCreates += 1; throw new FlowRequestError("timeout", "network_error", true); },
    async getStatus() { throw new Error("no esperado"); },
  }) });
  const result = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" });
  assert.equal(result.code, "payment_link_uncertain"); assert.equal(f.state.checkout.status, "uncertain"); assert.equal(f.state.gatewayCreates, 1);
  const retry = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: null });
  assert.equal(retry.code, "payment_link_uncertain"); assert.equal(f.state.gatewayCreates, 1);
});

test("errores 400/401 son definitivos y una respuesta Flow inválida falla segura", async () => {
  for (const error of [new FlowRequestError("rechazado", "http_400", false), new FlowRequestError("rechazado", "http_401", false)]) {
    const f = fixture({ gateway: (state) => ({ async findByCommerceOrder() { state.gatewayFinds += 1; return null; }, async createPayment() { state.gatewayCreates += 1; throw error; }, async getStatus() {} }) });
    await assert.rejects(executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" }), /rechazado/); assert.equal(f.state.checkout.status, "failed");
  }
});

test("pedido inválido no genera checkout Flow", async () => {
  for (const error of ["Order not found", "Order cancelled", "Order is not pending payment"]) {
    const f = fixture({ orderError: error }); const result = await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" });
    assert.equal(result.status, "business_error"); assert.equal(f.state.gatewayCreates, 0);
  }
  for (const order of [{ subtotal: 1 }, { total: 1 }, { currency: "USD" }, { orderStatus: "cancelled" }, { items: [{ ...item, quantity: 0, subtotal: 0 }], subtotal: 0, total: 0 }]) {
    const f = fixture({ order }); await assert.rejects(executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" }), /Checkout Flow inconsistente/); assert.equal(f.state.gatewayCreates, 0);
  }
});

test("modelo no puede alterar datos críticos y respuesta conserva URL literal", async () => {
  const f = fixture();
  await assert.rejects(executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com", amount: 1, paymentUrl: "https://evil.example" }), /Campos comerciales inválidos/);
  const message = formatCommerceResponse("create_payment_link", { status: "payment_link_ready", orderNumber: "COL-100001", paymentUrl: "https://sandbox.flow.cl/pay?token=LITERAL" }, {});
  assert.equal(message, "Perfecto 💛 tu pedido COL-100001 está listo. Puedes pagarlo aquí: https://sandbox.flow.cl/pay?token=LITERAL");
});

test("kill switch y handoff impiden claim; stock y pedido no cambian", async () => {
  for (const reason of ["global_disabled", "human_only", "temporary_human"]) {
    const f = fixture(); f.context.authorizeMutation = async () => { throw new Error(reason); };
    await assert.rejects(executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" }), new RegExp(reason)); assert.equal(f.state.rpcCalls.length, 0);
  }
  const f = fixture(); const before = { stock: f.state.stock, orderStatus: f.state.orderStatus };
  await executeCommerceTool(f.context, "create_payment_link", { payerEmail: "clienta@example.com" }); assert.deepEqual({ stock: f.state.stock, orderStatus: f.state.orderStatus }, before);
});

test("callbacks siguen públicos y el flujo web no muta commerce legacy", async () => {
  const proxy = await readFile(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  const confirmation = await readFile(new URL("../src/app/api/payments/flow/confirmation/route.ts", import.meta.url), "utf8");
  const returnRoute = await readFile(new URL("../src/app/api/payments/flow/return/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/payment-result/page.tsx", import.meta.url), "utf8");
  assert.match(proxy, /api\/payments\/flow\/confirmation/); assert.match(proxy, /api\/payments\/flow\/return/);
  assert.match(confirmation, /application\/x-www-form-urlencoded/); assert.match(confirmation, /confirmWebFlowToken/); assert.match(confirmation, /new Response\("OK"/);
  assert.match(returnRoute, /303/); assert.match(returnRoute, /payment-result/);
  for (const source of [confirmation, returnRoute, page]) assert.doesNotMatch(source, /commerce_orders|commerce_flow_checkouts|instagram_conversations/i);
});
