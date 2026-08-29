import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferAgentQuestion, isCommercialContextFresh, stateForIntent } from "../src/lib/channels/instagram/conversation-state.ts";
import { formatProductAttribute, formatVariantQuery, rephraseSalesQuestion, resolvePurchase, resolveSalesContinuation } from "../src/lib/channels/instagram/sales-context.ts";
import { classifyIntentByRules } from "../src/lib/channels/instagram/intent-rules.ts";
import { loadCommerceSnapshot } from "../src/lib/commerce/commerce-snapshot.ts";
import { resolveCommerceAction } from "../src/lib/commerce/conversation-resolver.ts";

const now = "2026-08-28T12:00:00.000Z";
const variantId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const context = (values = {}) => ({ state: "sales", stateAt: now, lastProductId: productId, lastVariantId: variantId, lastAgentQuestion: null, lastCommercialAction: "search_catalog", commercialContextAt: "2026-08-28T11:55:00.000Z", ...values });
const message = (text) => ({ channel: "instagram", eventId: "mid-state", externalUserId: "user-state", externalConversationId: "user-state", text, imageUrl: null, receivedAt: now });
const product = { id: productId, name: "Blusa Amelia", material: "Viscosa", fit: "Regular", price: 32990, variants: [{ id: "v-s", color: "Marfil", size: "S", stock: 2 }, { id: "v-m", color: "Marfil", size: "M", stock: 1 }] };
const selection = { status: "cart", currency: "CLP", subtotal: 65980, items: [{ productId, variantId, productName: "Blusa Amelia", productSku: "AME", variantSku: "AME-MAR-M", color: "Marfil", size: "M", quantity: 2, unitPrice: 32990, subtotal: 65980 }] };
const order = { status: "order_created", orderId: "order-1", orderNumber: "COL-100001", orderStatus: "pending_payment", currency: "CLP", subtotal: 65980, total: 65980, items: selection.items };
const snapshot = (values = {}) => ({ focusedProduct: { id: productId, name: "Blusa Amelia" }, focusedVariant: { id: variantId, productId, color: "Marfil", size: "M", stock: 4 }, selectedItems: selection.items, selectedQuantity: 2, selectionTotal: 65980, selection, latestOrder: null, latestOrderStatus: null, flowCheckoutStatus: null, payerEmailPresent: false, paymentUrlPresent: false, paymentUrl: null, ...values });

test("012 persiste solo estado estructurado y amplía handoff de seguimiento", async () => {
  const sql = await readFile(new URL("../supabase/migrations/012_instagram_conversation_state.sql", import.meta.url), "utf8");
  for (const column of ["conversation_state", "conversation_state_at", "last_product_id", "last_variant_id", "last_agent_question", "last_commercial_action", "commercial_context_at"]) assert.match(sql, new RegExp(column));
  for (const state of ["unscoped", "sales", "after_sales", "order_tracking", "human"]) assert.match(sql, new RegExp(`'${state}'`));
  assert.match(sql, /security invoker/i); assert.match(sql, /conversation_state = 'human'/i);
  assert.doesNotMatch(sql, /message_text|message_content|message_body|dm_text|history/i);
});

test("estado deriva de intenciones sensibles y comerciales", () => {
  assert.equal(stateForIntent("sales"), "sales"); assert.equal(stateForIntent("exchange_return"), "after_sales");
  assert.equal(stateForIntent("order_tracking"), "order_tracking"); assert.equal(stateForIntent("human_request"), "human");
  assert.equal(stateForIntent("general_info"), null);
});

test("M y color se resuelven antes del LLM usando la última pregunta", () => {
  assert.deepEqual(resolveSalesContinuation("M", context({ lastAgentQuestion: "ask_size" }), true), { kind: "agent", text: "La clienta eligió talla M para el producto que estaba en foco. Confirma la variante real con search_catalog antes de ofrecer agregarla." });
  assert.equal(resolveSalesContinuation("negro", context({ lastAgentQuestion: "ask_color" }), true).kind, "agent");
});

test("processor recupera el nombre real del producto focal para continuar tras reinicios", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  assert.match(source, /loadFocusedProductName\(dependencies\.supabase, commercialContext\.lastProductId\)/);
  assert.match(source, /producto focal validado/i);
});

test("confirmaciones elípticas producen tools con variante persistida", () => {
  assert.deepEqual(resolveSalesContinuation("Sí", context({ lastAgentQuestion: "confirm_add" }), true), { kind: "tool", tool: "add_to_cart", input: { variantId, quantity: 1 } });
  assert.deepEqual(resolveSalesContinuation("Sí", context({ lastAgentQuestion: "confirm_quantity" }), true), { kind: "tool", tool: "set_cart_quantity", input: { variantId, quantity: 1 } });
  assert.deepEqual(resolveSalesContinuation("Sí", context({ lastAgentQuestion: "confirm_order" }), true), { kind: "tool", tool: "create_order", input: {} });
});

test("solo quiero unos tolera el error y confirma cantidad sin handoff", () => {
  const result = resolveSalesContinuation("Solo quiero unos", context(), true);
  assert.equal(result.kind, "clarify"); assert.equal(result.question, "confirm_quantity"); assert.match(result.response, /solo 1 unidad/i);
});

test("referencias naturales usan foco real o preguntan sin handoff", () => {
  assert.equal(resolveSalesContinuation("Ese", context(), true).kind, "tool");
  const productOnly = resolveSalesContinuation("Lo compro", context({ lastVariantId: null }), true);
  assert.equal(productOnly.kind, "clarify"); assert.equal(productOnly.question, "ask_size");
  assert.match(resolveSalesContinuation("Ese", context({ lastProductId: null, lastVariantId: null }), true).response, /cuál/i);
});

test("pago y email continúan ventas sin inventar pedido ni correo", () => {
  const payment = resolveSalesContinuation("¿Cómo pago?", context(), true);
  assert.deepEqual(payment, { kind: "commerce_action", action: "pay" });
  assert.deepEqual(resolveSalesContinuation("Perfecto, dime cómo debo pagar", context(), true), { kind: "commerce_action", action: "pay" });
  assert.deepEqual(resolveSalesContinuation("Ninguno, quiero pagar", context(), true), { kind: "commerce_action", action: "pay" });
  assert.deepEqual(resolveSalesContinuation("clienta@example.com", context({ lastAgentQuestion: "ask_email" }), true), { kind: "tool", tool: "create_payment_link", input: { payerEmail: "clienta@example.com" } });
});

test("atributos del producto focal se resuelven con catálogo y nunca se inventan", () => {
  assert.deepEqual(resolveSalesContinuation("¿Qué tipo de tela es?", context(), true), { kind: "attribute", attribute: "material" });
  assert.equal(formatProductAttribute(product, "material"), "Blusa Amelia está registrada en Viscosa.");
  assert.equal(formatProductAttribute({ ...product, material: "" }, "material"), "Ese dato no lo tengo registrado. Sí puedo ayudarte con talla, color, precio y disponibilidad.");
  assert.match(formatProductAttribute(product, "size"), /S y M/); assert.match(formatProductAttribute(product, "price"), /\$32\.990/);
  assert.equal(resolveSalesContinuation("¿Qué tela es?", context({ lastProductId: null }), true).kind, "attribute");
});

test("otra variante se compara contra el catálogo focal", () => {
  assert.deepEqual(resolveSalesContinuation("¿En negro la tienes?", context(), true), { kind: "variant_query", value: "negro" });
  assert.equal(formatVariantQuery(product, "negro"), "Blusa Amelia no está registrada en negro.");
  assert.match(formatVariantQuery(product, "marfil"), /S y M/);
});

test("meta-conversación reformula en lugar de repetir el fallback", () => {
  assert.deepEqual(resolveSalesContinuation("No entiendo", context({ lastAgentQuestion: "ask_size" }), true), { kind: "rephrase" });
  assert.equal(rephraseSalesQuestion(context({ lastAgentQuestion: "ask_size" }), product), "Perdón. Te preguntaba qué talla prefieres para Blusa Amelia.");
  const previousFallback = "¿Qué quieres hacer con tu selección o qué producto quieres seguir viendo?";
  assert.notEqual(rephraseSalesQuestion(context({ lastAgentQuestion: null }), product), previousFallback);
});

test("intención de compra usa foco, pide talla o guía a cerrar pedido", () => {
  for (const text of ["Cómo compro", "La quiero", "Me la llevo"]) assert.equal(resolveSalesContinuation(text, context(), true).kind, "purchase", text);
  assert.deepEqual(resolveSalesContinuation("Quiero comprar", context(), true), { kind: "commerce_action", action: "close" });
  assert.deepEqual(resolveSalesContinuation("Quiero comprar esa", context(), true), { kind: "commerce_action", action: "close" });
  const needsSize = resolvePurchase(product, context({ lastVariantId: null }));
  assert.equal(needsSize.kind, "clarify"); assert.equal(needsSize.question, "ask_size"); assert.match(needsSize.response, /S y M/);
  assert.deepEqual(resolvePurchase(null, context({ lastProductId: null, lastVariantId: null })), { kind: "clarify", response: "¿Qué producto quieres comprar?", question: null });
  const closeOrder = resolvePurchase(product, context({ lastCommercialAction: "add_item" }));
  assert.equal(closeOrder.kind, "clarify"); assert.equal(closeOrder.question, "confirm_order");
});

test("cantidades naturales se resuelven exactamente antes de cierre", () => {
  for (const [text, quantity] of [["uno", 1], ["2", 2], ["tres", 3], ["Quiero dos", 2], ["Dame dos", 2], ["Déjame dos", 2], ["dos de esas", 2], ["Quiero comprar dos de esas", 2]]) {
    assert.deepEqual(resolveSalesContinuation(text, context(), true), { kind: "quantity", quantity }, text);
  }
});

test("consultas del pedido final nunca llegan al fallback", () => {
  for (const text of ["¿Cuál es el pedido final?", "¿Cuál es mi pedido?", "¿Qué llevo?", "¿Qué tengo en el pedido?", "¿Qué tengo seleccionado?"]) {
    assert.deepEqual(resolveSalesContinuation(text, context(), true), { kind: "commerce_action", action: "summary" }, text);
  }
});

test("commerce snapshot reúne selección, pedido y Flow sin datos del modelo", async () => {
  const rows = {
    instagram_conversations: { id: "conversation-1" },
    products: { id: productId, name: "Blusa Amelia" },
    product_variants: { id: variantId, product_id: productId, color: "Marfil", size: "M", stock: 4 },
    commerce_orders: { id: "order-1", order_number: "COL-100001", status: "pending_payment", currency: "CLP", subtotal: 65980, total: 65980, created_at: now, commerce_order_items: [{ product_id: productId, variant_id: variantId, product_name: "Blusa Amelia", product_sku: "AME", variant_sku: "AME-MAR-M", color: "Marfil", size: "M", quantity: 2, unit_price: 32990, subtotal: 65980 }] },
    commerce_flow_checkouts: { status: "ready", payer_email: "clienta@example.com", payment_url: "https://sandbox.flow.cl/app/web/pay.php?token=literal" },
  };
  const chain = (value) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, async single() { return { data: value, error: null }; }, async maybeSingle() { return { data: value, error: null }; } });
  const supabase = { from(name) { return chain(rows[name]); }, async rpc() { return { data: { status: "cart", currency: "CLP", subtotal: 65980, items: [{ productId, variantId, productName: "Blusa Amelia", color: "Marfil", size: "M", quantity: 2, unitPrice: 32990, subtotal: 65980 }] }, error: null }; } };
  const snapshot = await loadCommerceSnapshot(supabase, "external-user", { productId, variantId });
  assert.equal(snapshot.focusedProduct.name, "Blusa Amelia"); assert.equal(snapshot.focusedVariant.size, "M");
  assert.equal(snapshot.selectedQuantity, 2); assert.equal(snapshot.selectionTotal, 65980);
  assert.equal(snapshot.latestOrder.orderNumber, "COL-100001"); assert.equal(snapshot.latestOrderStatus, "pending_payment");
  assert.equal(snapshot.flowCheckoutStatus, "ready"); assert.equal(snapshot.payerEmailPresent, true); assert.equal(snapshot.paymentUrlPresent, true);
  assert.equal(snapshot.paymentUrl, "https://sandbox.flow.cl/app/web/pay.php?token=literal");
});

test("cierre y pago dependen exclusivamente del snapshot real", () => {
  const empty = snapshot({ selectedItems: [], selectedQuantity: 0, selectionTotal: 0, selection: { status: "empty", currency: "CLP", subtotal: 0, items: [] } });
  assert.match(resolveCommerceAction("pay", empty, null, context()).response, /Primero dime qué producto/i);

  const confirm = resolveCommerceAction("pay", snapshot(), product, context());
  assert.equal(confirm.kind, "snapshot_response"); assert.equal(confirm.question, "confirm_order");
  assert.match(confirm.response, /2 × \$32\.990/); assert.match(confirm.response, /\$65\.980/);

  const summary = resolveCommerceAction("summary", snapshot(), product, context());
  assert.equal(summary.kind, "snapshot_response"); assert.match(summary.response, /Blusa Amelia/); assert.match(summary.response, /\$65\.980/);
});

test("pedido pending_payment solicita email o reutiliza checkout Flow", () => {
  const pending = snapshot({ latestOrder: order, latestOrderStatus: "pending_payment", selectedItems: [] });
  const asksEmail = resolveCommerceAction("pay", pending, product, context());
  assert.equal(asksEmail.kind, "snapshot_response"); assert.equal(asksEmail.question, "ask_email"); assert.match(asksEmail.response, /correo/i);

  const persistedUrl = "https://sandbox.flow.cl/app/web/pay.php?token=literal";
  const ready = resolveCommerceAction("pay", { ...pending, flowCheckoutStatus: "ready", payerEmailPresent: true, paymentUrlPresent: true, paymentUrl: persistedUrl }, product, context());
  assert.equal(ready.kind, "snapshot_response"); assert.match(ready.response, new RegExp(persistedUrl.replace(/[?]/g, "\\?")));

  const creating = resolveCommerceAction("pay", { ...pending, flowCheckoutStatus: "creating", payerEmailPresent: true }, product, context());
  assert.match(creating.response, /preparando el link/i);
  const uncertain = resolveCommerceAction("pay", { ...pending, flowCheckoutStatus: "uncertain", payerEmailPresent: true }, product, context());
  assert.match(uncertain.response, /no generar un cobro duplicado/i);
  assert.deepEqual(resolveCommerceAction("pay", { ...pending, flowCheckoutStatus: "failed", payerEmailPresent: true }, product, context()), { kind: "tool", tool: "create_payment_link", input: { payerEmail: null } });
});

test("contexto vencido mantiene sales pero no asume foco", () => {
  const stale = context({ commercialContextAt: "2026-08-28T11:29:59.000Z" });
  assert.equal(isCommercialContextFresh(stale, now), false);
  const result = resolveSalesContinuation("Ese", stale, false);
  assert.equal(result.kind, "clarify"); assert.match(result.response, /qué producto/i);
});

test("typo dentro de sales pide aclaración contextual", () => {
  const result = resolveSalesContinuation("qiero esoo", context(), true);
  assert.equal(result.kind, "clarify"); assert.match(result.response, /selección|producto/i);
});

test("señales sensibles conservan prioridad sobre sales", () => {
  const state = { lastIntent: "sales", lastIntentAt: "2026-08-28T11:55:00.000Z" };
  assert.equal(classifyIntentByRules(message("Lo compré ayer y quiero cambiarlo"), state)?.intent, "exchange_return");
  assert.equal(classifyIntentByRules(message("Dónde está mi pedido?"), state)?.intent, "order_tracking");
  assert.equal(classifyIntentByRules(message("Quiero hablar con una persona"), state)?.intent, "human_request");
});

test("preguntas controladas se derivan server-side", () => {
  assert.equal(inferAgentQuestion("Perfecto. ¿Qué talla quieres?"), "ask_size");
  assert.equal(inferAgentQuestion("Primero confirmamos tu selección. ¿Lo cerramos así?"), "confirm_order");
  assert.equal(inferAgentQuestion("Perfecto 💛 Para generar tu link necesito tu correo. ¿Me lo compartes?"), "ask_email");
});

test("processor conserva estado y handoff pero entrega sales exclusivamente al advisor", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  assert.match(source, /getConversationContext[\s\S]*sensitiveIntent[\s\S]*routeInstagramIntent/);
  assert.match(source, /commercialContext\.state !== "sales" && classification\.intent === "unknown"/);
  const active = source.split("/* Flujo transaccional")[0];
  assert.match(active, /instagramAdvisorModeEnabled[\s\S]*runInstagramAdvisor/);
  assert.doesNotMatch(active, /resolveSalesContinuation|loadCommerceSnapshot|resolveCommerceAction|executeCommerceTool/);
});
