import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { executeCommerceTool } from "../src/lib/commerce/tools.ts";

const variantId = "11111111-1111-4111-8111-111111111111";

function commerceFixture({ stock = 20, price = 44990, forcedError = null } = {}) {
  const state = { cart: null, operations: new Map(), stock, price, orders: [], rpcCalls: 0 };
  const snapshot = () => state.cart ? { status: "cart", cartId: "cart-1", cartStatus: state.cart.status, currency: "CLP", items: [...state.cart.items.values()].map((item) => ({ productId: "product-1", variantId, productName: "Blazer Emilia", productSku: "CHA-001", variantSku: "CHA-001-NEG-M", color: "Negro", size: "M", quantity: item.quantity, unitPrice: item.unitPrice, subtotal: item.quantity * item.unitPrice, currentStock: state.stock })), subtotal: [...state.cart.items.values()].reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) } : { status: "empty", currency: "CLP", items: [], subtotal: 0 };
  const fail = (message) => ({ data: null, error: { message } });
  const supabase = {
    from(name) {
      const query = {
        select() { return query; }, eq() { return query; },
        async single() {
          if (name !== "product_variants") return { data: null, error: { message: "Unexpected table" } };
          return { data: { id: variantId, color: "Negro", size: "M", stock: state.stock, products: { name: "Blazer Emilia" } }, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
    state.rpcCalls += 1;
    if (name === "get_instagram_cart") return { data: snapshot(), error: null };
    const key = `${args.p_event_id}:${args.p_operation_key ?? "create_order"}`;
    if (state.operations.has(key)) return { data: structuredClone(state.operations.get(key)), error: null };
    if (forcedError) return fail(forcedError);
    if (name === "mutate_instagram_cart") {
      if (args.p_variant_id !== variantId) return fail("Product or variant is unavailable");
      if (!state.cart) state.cart = { status: "open", items: new Map() };
      const existing = state.cart.items.get(variantId)?.quantity ?? 0;
      if (args.p_operation_type === "remove_from_cart") state.cart.items.delete(variantId);
      else {
        const target = args.p_operation_type === "add_to_cart" ? existing + args.p_quantity : args.p_quantity;
        if (target > 20) return fail("Accumulated quantity exceeds 20");
        if (target > state.stock) return fail("Insufficient stock");
        state.cart.items.set(variantId, { quantity: target, unitPrice: state.price });
      }
      const result = snapshot(); state.operations.set(key, structuredClone(result)); return { data: result, error: null };
    }
    if (name === "create_instagram_order") {
      if (!state.cart || state.cart.status !== "open") return fail("Open cart not found");
      if (state.cart.items.size === 0) return fail("Cart is empty");
      const item = state.cart.items.get(variantId);
      if (item.quantity > state.stock) return fail("Insufficient stock");
      if (item.unitPrice !== state.price) {
        item.unitPrice = state.price;
        const result = { ...snapshot(), status: "price_changed", requiresConfirmation: true };
        state.operations.set(key, structuredClone(result)); return { data: result, error: null };
      }
      const result = { status: "order_created", orderId: `order-${state.orders.length + 1}`, orderNumber: `COL-${100001 + state.orders.length}`, orderStatus: "pending_payment", currency: "CLP", subtotal: item.quantity * item.unitPrice, total: item.quantity * item.unitPrice, items: snapshot().items };
      state.orders.push(structuredClone(result)); state.cart.status = "converted"; state.operations.set(key, structuredClone(result)); return { data: result, error: null };
    }
    return fail("Unknown RPC");
  } };
  return { state, supabase };
}

function context(fixture, eventId = "mid-1", authorizeMutation = async () => undefined) {
  return { supabase: fixture.supabase, externalUserId: "ig-user-1", eventId, authorizeMutation };
}

test("la migración 006 contiene tablas, RLS, número backend y RPC transaccionales", async () => {
  const sql = await readFile(new URL("../supabase/migrations/006_instagram_cart_and_orders.sql", import.meta.url), "utf8");
  for (const token of ["commerce_carts", "commerce_cart_items", "commerce_orders", "commerce_order_items", "commerce_operations", "commerce_order_number_seq", "COL-", "mutate_instagram_cart", "create_instagram_order", "price_changed", "enable row level security", "service_role"]) assert.match(sql, new RegExp(token));
  assert.match(sql, /quantity between 1 and 20/);
  assert.match(sql, /unique \(channel, external_event_id, operation_key\)/);
});

test("la migración 007 conserva SECURITY INVOKER y no bloquea ni concede UPDATE al catálogo", async () => {
  const sql = await readFile(new URL("../supabase/migrations/007_fix_commerce_catalog_row_locks.sql", import.meta.url), "utf8");
  assert.match(sql, /mutate_instagram_cart[\s\S]*security invoker/i);
  assert.match(sql, /create_instagram_order[\s\S]*security invoker/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /grant\s+update[\s\S]*(products|product_variants)/i);
  assert.doesNotMatch(sql, /for update of\s+v\s*,\s*p/i);
  assert.doesNotMatch(sql, /for update of\s+i\s*,\s*p\s*,\s*v/i);
  assert.match(sql, /where i\.cart_id=v_cart_id for update of i/i);
});

test("crea y reutiliza un único carrito abierto con producto y variante reales", async () => {
  const fixture = commerceFixture();
  const first = await executeCommerceTool(context(fixture, "mid-1"), "add_to_cart", { variantId, quantity: 1 });
  const second = await executeCommerceTool(context(fixture, "mid-2"), "add_to_cart", { variantId, quantity: 2 });
  assert.equal(first.cartId, second.cartId); assert.equal(second.items[0].quantity, 3); assert.equal(second.items[0].unitPrice, 44990);
});

test("rechaza variante inexistente y stock insuficiente", async () => {
  const fixture = commerceFixture({ stock: 2 });
  const unavailable = await executeCommerceTool(context(fixture), "add_to_cart", { variantId: "22222222-2222-4222-8222-222222222222", quantity: 1 });
  const insufficient = await executeCommerceTool(context(fixture, "mid-2"), "add_to_cart", { variantId, quantity: 3 });
  assert.equal(unavailable.code, "unavailable"); assert.equal(insufficient.code, "insufficient_stock"); assert.equal(insufficient.currentStock, 2);
});

test("rechaza cantidad cero, negativa y mayor que 20 antes de Supabase", async () => {
  for (const quantity of [0, -1, 21]) {
    const fixture = commerceFixture();
    const result = await executeCommerceTool(context(fixture), "add_to_cart", { variantId, quantity });
    assert.equal(result.code, "invalid_quantity");
    assert.equal(fixture.state.rpcCalls, 0);
  }
});

test("rechaza acumulación superior a 20", async () => {
  const fixture = commerceFixture();
  await executeCommerceTool(context(fixture, "mid-1"), "add_to_cart", { variantId, quantity: 20 });
  const result = await executeCommerceTool(context(fixture, "mid-2"), "add_to_cart", { variantId, quantity: 1 });
  assert.equal(result.code, "quantity_limit_exceeded");
});

test("add, remove y set quantity son idempotentes por evento y operación", async () => {
  const fixture = commerceFixture();
  await executeCommerceTool(context(fixture, "add-event"), "add_to_cart", { variantId, quantity: 2 });
  await executeCommerceTool(context(fixture, "add-event"), "add_to_cart", { variantId, quantity: 2 });
  assert.equal(fixture.state.cart.items.get(variantId).quantity, 2);
  await executeCommerceTool(context(fixture, "set-event"), "set_cart_quantity", { variantId, quantity: 4 });
  await executeCommerceTool(context(fixture, "set-event"), "set_cart_quantity", { variantId, quantity: 4 });
  assert.equal(fixture.state.cart.items.get(variantId).quantity, 4);
  await executeCommerceTool(context(fixture, "remove-event"), "remove_from_cart", { variantId });
  await executeCommerceTool(context(fixture, "remove-event"), "remove_from_cart", { variantId });
  assert.equal(fixture.state.cart.items.size, 0);
});

test("un carrito inexistente o vacío no crea pedido", async () => {
  const fixture = commerceFixture();
  const missing = await executeCommerceTool(context(fixture), "create_order", {});
  assert.equal(missing.code, "open_cart_not_found");
  await executeCommerceTool(context(fixture, "add"), "add_to_cart", { variantId, quantity: 1 });
  await executeCommerceTool(context(fixture, "remove"), "remove_from_cart", { variantId });
  const empty = await executeCommerceTool(context(fixture, "confirm"), "create_order", {});
  assert.equal(empty.code, "empty_cart");
  assert.equal(fixture.state.orders.length, 0);
});

test("precio cambiado actualiza carrito, exige evento posterior y luego crea pedido", async () => {
  const fixture = commerceFixture({ price: 44990 });
  await executeCommerceTool(context(fixture, "add"), "add_to_cart", { variantId, quantity: 1 });
  fixture.state.price = 46990;
  const changed = await executeCommerceTool(context(fixture, "confirm-1"), "create_order", {});
  assert.equal(changed.status, "price_changed"); assert.equal(changed.requiresConfirmation, true); assert.equal(fixture.state.orders.length, 0); assert.equal(changed.subtotal, 46990);
  const retry = await executeCommerceTool(context(fixture, "confirm-1"), "create_order", {});
  assert.equal(retry.status, "price_changed"); assert.equal(fixture.state.orders.length, 0);
  const created = await executeCommerceTool(context(fixture, "confirm-2"), "create_order", {});
  assert.equal(created.status, "order_created"); assert.equal(created.total, 46990);
});

test("retry de create_order no duplica y conserva snapshot y referencia backend", async () => {
  const fixture = commerceFixture();
  await executeCommerceTool(context(fixture, "add"), "add_to_cart", { variantId, quantity: 2 });
  const first = await executeCommerceTool(context(fixture, "confirm"), "create_order", {});
  const retry = await executeCommerceTool(context(fixture, "confirm"), "create_order", {});
  assert.deepEqual(retry, first); assert.equal(fixture.state.orders.length, 1); assert.match(first.orderNumber, /^COL-\d+$/);
  assert.deepEqual(first.items[0], { productId: "product-1", variantId, productName: "Blazer Emilia", productSku: "CHA-001", variantSku: "CHA-001-NEG-M", color: "Negro", size: "M", quantity: 2, unitPrice: 44990, subtotal: 89980, currentStock: 20 });
});

test("kill switch y handoff impiden mutaciones antes de Supabase", async () => {
  for (const reason of ["global_disabled", "human_only"]) {
    const fixture = commerceFixture();
    await assert.rejects(executeCommerceTool(context(fixture, reason, async () => { throw new Error(reason); }), "add_to_cart", { variantId, quantity: 1 }), new RegExp(reason));
    assert.equal(fixture.state.rpcCalls, 0); assert.equal(fixture.state.cart, null);
  }
});

test("las tools mutantes rechazan campos objetivos enviados por el modelo", async () => {
  const fixture = commerceFixture();
  await assert.rejects(executeCommerceTool(context(fixture), "add_to_cart", { variantId, quantity: 1, price: 1, color: "inventado" }), /Campos comerciales inválidos/);
  assert.equal(fixture.state.rpcCalls, 0);
});

test("stock agotado respecto del carrito produce una respuesta factual controlada", async () => {
  const fixture = commerceFixture({ stock: 1 });
  await executeCommerceTool(context(fixture, "add-1"), "add_to_cart", { variantId, quantity: 1 });
  const result = await executeCommerceTool(context(fixture, "add-2"), "add_to_cart", { variantId, quantity: 1 });
  assert.equal(result.status, "business_error");
  assert.equal(result.currentStock, 1); assert.equal(result.cartQuantity, 1);
  assert.equal(result.customerMessage, "No puedo agregar otra unidad de Blazer Emilia Negro talla M porque queda 1 unidad disponible y ya la tienes en tu selección.");
});

test("mapea todos los errores comerciales esperables sin propagarlos", async () => {
  const cases = [
    ["Quantity must be between 1 and 20", "invalid_quantity"],
    ["Accumulated quantity exceeds 20", "quantity_limit_exceeded"],
    ["Cart item not found", "cart_item_not_found"],
    ["Open cart not found", "open_cart_not_found"],
    ["Cart is empty", "empty_cart"],
    ["Product or variant is unavailable", "unavailable"],
  ];
  for (const [message, code] of cases) {
    const fixture = commerceFixture({ forcedError: message });
    const result = await executeCommerceTool(context(fixture), "add_to_cart", { variantId, quantity: 1 });
    assert.equal(result.status, "business_error"); assert.equal(result.code, code); assert.equal(typeof result.customerMessage, "string");
  }
});

test("errores técnicos y permisos continúan propagándose de forma fail-closed", async () => {
  for (const message of ["permission denied for table product_variants", "fetch failed", "duplicate key value violates unique constraint unknown_constraint"]) {
    const fixture = commerceFixture({ forcedError: message });
    await assert.rejects(executeCommerceTool(context(fixture), "add_to_cart", { variantId, quantity: 1 }), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
