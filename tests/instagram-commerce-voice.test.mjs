import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatCommerceResponse } from "../src/lib/commerce/response-formatter.ts";

const renata = { variantId: "variant-renata", productName: "Pantalón Renata", variantSku: "REN-NEG-M", color: "Negro", size: "M", quantity: 2, unitPrice: 42990, subtotal: 85980 };
const amelia = { variantId: "variant-amelia", productName: "Blusa Amelia", variantSku: "AME-MAR-M", color: "Marfil", size: "M", quantity: 1, unitPrice: 32990, subtotal: 32990 };
const cart = { status: "cart", items: [renata, amelia], subtotal: 118970 };

function emojis(value) {
  return value.match(/[😊✨💛]/gu) ?? [];
}

test("la voz transaccional es breve, natural y no repite aperturas robóticas", () => {
  const message = formatCommerceResponse("add_to_cart", { status: "cart", items: [{ ...amelia }], subtotal: 32990 }, { variantId: amelia.variantId });
  assert.match(message, /dejé .* en tu pedido/i);
  assert.doesNotMatch(message, /carrito/i);
  assert.doesNotMatch(message, /^(Listo|Claro|Opciones disponibles)/i);
  assert.doesNotMatch(message, /Si quieres/i);
  assert.ok(emojis(message).length <= 1);
});

test("los formateadores usan como máximo un emoji permitido", () => {
  const messages = [
    formatCommerceResponse("view_cart", cart, {}),
    formatCommerceResponse("create_order", { status: "order_created", orderNumber: "COL-100001", orderStatus: "pending_payment", items: cart.items, subtotal: 118970, total: 118970 }, {}),
  ];
  for (const message of messages) {
    assert.ok(emojis(message).length <= 1);
    assert.doesNotMatch(message.replace(/[😊✨💛]/gu, ""), /\p{Extended_Pictographic}/gu);
  }
});

test("view_cart muestra todos los items e importes exactos entregados por la tool", () => {
  const message = formatCommerceResponse("view_cart", cart, {});
  for (const expected of ["Pantalón Renata", "Blusa Amelia", "$42.990", "$85.980", "$32.990", "$118.970"]) assert.match(message, new RegExp(expected.replace("$", "\\$")));
});

test("create_order conserva orderNumber y total exactos", () => {
  const message = formatCommerceResponse("create_order", { status: "order_created", orderNumber: "COL-100001", orderStatus: "pending_payment", items: cart.items, subtotal: 118970, total: 118970 }, {});
  assert.match(message, /COL-100001/);
  assert.match(message, /\$118\.970/);
  assert.match(message, /Pantalón Renata/);
  assert.match(message, /Blusa Amelia/);
  assert.match(message, /\$85\.980/);
  assert.match(message, /\$32\.990/);
  assert.match(message, /pendiente de pago/i);
});

test("price_changed exige una confirmación posterior y muestra el nuevo total", () => {
  const message = formatCommerceResponse("create_order", { status: "price_changed", requiresConfirmation: true, items: cart.items, subtotal: 118970 }, {});
  assert.match(message, /\$118\.970/);
  assert.match(message, /confírmame nuevamente/i);
});

test("los errores comerciales conservan literalmente su mensaje determinista", () => {
  const customerMessage = "En M me queda solo 1, y esa ya la tienes en tu carrito.";
  assert.equal(formatCommerceResponse("add_to_cart", { status: "business_error", customerMessage }, { variantId: renata.variantId }), customerMessage);
});

test("las respuestas transaccionales regresan desde el runner sin una segunda llamada al modelo", async () => {
  const source = await readFile(new URL("../src/lib/agent/runner.ts", import.meta.url), "utf8");
  assert.match(source, /return \{ message: formatCommerceResponse\(call\.name, toolResult, parsedArguments\)/);
  assert.doesNotMatch(source, /formatCommerceResponse[\s\S]{0,200}function_call_output/);
});

test("una inconsistencia del total del carrito falla de forma segura", () => {
  assert.throws(() => formatCommerceResponse("view_cart", { ...cart, subtotal: 999999 }, {}), /Respuesta comercial inconsistente/);
});

test("una inconsistencia del pedido falla de forma segura", () => {
  assert.throws(() => formatCommerceResponse("create_order", { status: "order_created", orderNumber: "COL-100001", orderStatus: "pending_payment", items: cart.items, subtotal: 118970, total: 168970 }, {}), /Respuesta comercial inconsistente/);
});

test("el prompt fija brevedad, styling prudente y ejemplos buenos y malos", async () => {
  const prompt = await readFile(new URL("../src/lib/agent/prompt.ts", import.meta.url), "utf8");
  assert.match(prompt, /1 a 3 frases/);
  assert.match(prompt, /No digas que algo “le quedará bien” sin contexto suficiente/);
  assert.match(prompt, /EJEMPLOS DE VOZ/);
  assert.match(prompt, /No generes urgencia artificial/);
});
