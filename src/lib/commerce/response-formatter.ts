import type { CommerceToolName, CommerceToolResult } from "./types";

type CommerceItem = {
  variantId: string;
  productName: string;
  variantSku: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

function technical(message: string): never {
  throw new Error(`Respuesta comercial inconsistente: ${message}`);
}

function text(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) return technical(`falta ${field}`);
  return value.trim();
}

function number(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return technical(`${field} inválido`);
  return parsed;
}

function items(result: CommerceToolResult) {
  if (!Array.isArray(result.items)) return technical("faltan items");
  return result.items.map((raw, index): CommerceItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return technical(`item ${index + 1} inválido`);
    const item = raw as Record<string, unknown>;
    const quantity = number(item.quantity, `quantity del item ${index + 1}`);
    if (!Number.isInteger(quantity) || quantity < 1) return technical(`quantity del item ${index + 1} inválido`);
    return {
      variantId: text(item.variantId, `variantId del item ${index + 1}`),
      productName: text(item.productName, `productName del item ${index + 1}`),
      variantSku: text(item.variantSku, `variantSku del item ${index + 1}`),
      color: text(item.color, `color del item ${index + 1}`),
      size: text(item.size, `size del item ${index + 1}`),
      quantity,
      unitPrice: number(item.unitPrice, `unitPrice del item ${index + 1}`),
      subtotal: number(item.subtotal, `subtotal del item ${index + 1}`),
    };
  });
}

function validateCart(result: CommerceToolResult) {
  const parsedItems = items(result);
  const subtotal = result.subtotal === undefined ? undefined : number(result.subtotal, "subtotal del carrito");
  if (subtotal !== undefined) {
    const itemSum = parsedItems.reduce((sum, item) => sum + item.subtotal, 0);
    if (itemSum !== subtotal) return technical("la suma de items no coincide con el subtotal del carrito");
  }
  return { parsedItems, subtotal };
}

function validateOrder(result: CommerceToolResult) {
  const parsedItems = items(result);
  const subtotal = number(result.subtotal, "subtotal del pedido");
  const total = number(result.total, "total del pedido");
  const itemSum = parsedItems.reduce((sum, item) => sum + item.subtotal, 0);
  if (itemSum !== subtotal) return technical("la suma de items no coincide con el subtotal del pedido");
  if (subtotal !== total) return technical("subtotal y total del pedido no coinciden");
  return { parsedItems, subtotal, total };
}

const money = (value: number) => `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)}`;
const itemLabel = (item: CommerceItem) => `${item.productName} ${item.color.toLocaleLowerCase("es-CL")} en ${item.size}`;

export function formatCommerceResponse(tool: CommerceToolName, result: CommerceToolResult, input: unknown) {
  if (result.status === "business_error") return text(result.customerMessage, "customerMessage");

  if (result.status === "order_created") {
    const { parsedItems, total } = validateOrder(result);
    const orderNumber = text(result.orderNumber, "orderNumber");
    if (text(result.orderStatus, "orderStatus") !== "pending_payment") return technical("estado de pedido inesperado");
    const orderItems = parsedItems.map((item) => `${item.quantity} × ${itemLabel(item)} por ${money(item.subtotal)}`).join("; ");
    return `Perfecto 💛 ya dejé tu pedido armado: ${orderItems}. Pedido ${orderNumber} · Total ${money(total)}. Ahora queda pendiente de pago.`;
  }

  if (result.status === "price_changed") {
    const { subtotal } = validateCart(result);
    if (subtotal === undefined || result.requiresConfirmation !== true) return technical("price_changed incompleto");
    return `El precio cambió y actualicé tu carrito. El nuevo total es ${money(subtotal)}; confírmame nuevamente si dejamos el pedido armado.`;
  }

  const { parsedItems, subtotal } = validateCart(result);
  if (tool === "view_cart") {
    if (parsedItems.length === 0) return "Tu carrito está vacío.";
    if (subtotal === undefined) return technical("view_cart no devolvió subtotal");
    const lines = parsedItems.map((item) => `${item.productName} · ${item.color} · ${item.size} · ${item.quantity} × ${money(item.unitPrice)} · ${money(item.subtotal)}`);
    return `En tu carrito tienes:\n${lines.join("\n")}\n\nTotal: ${money(subtotal)}.`;
  }

  if (tool === "remove_from_cart") {
    if (parsedItems.length === 0) return "Ya lo saqué del carrito; quedó vacío.";
    if (subtotal === undefined) return technical("remove_from_cart no devolvió subtotal");
    return `Ya lo saqué del carrito. El total queda en ${money(subtotal)}.`;
  }

  if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as { variantId?: unknown }).variantId !== "string") return technical(`${tool} no tiene variantId`);
  const selected = parsedItems.find((item) => item.variantId === (input as { variantId: string }).variantId);
  if (!selected) return technical(`${tool} no devolvió la variante seleccionada`);
  if (tool === "add_to_cart") return `Perfecto, dejé ${itemLabel(selected)} en tu carrito por ${money(selected.unitPrice)}. Llevas ${selected.quantity} ${selected.quantity === 1 ? "unidad" : "unidades"}.`;
  if (tool === "set_cart_quantity") {
    if (subtotal === undefined) return technical("set_cart_quantity no devolvió subtotal");
    return `Perfecto, dejé ${selected.quantity} ${selected.quantity === 1 ? "unidad" : "unidades"} de ${itemLabel(selected)}. Tu carrito queda en ${money(subtotal)}.`;
  }
  return technical(`tool no soportada: ${tool}`);
}
