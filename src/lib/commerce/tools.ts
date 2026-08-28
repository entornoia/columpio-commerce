import type { CommerceToolName, CommerceToolResult, InstagramCommerceContext } from "./types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function objectInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Entrada comercial inválida.");
  return input as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some((key) => !expected.includes(key))) throw new Error("Campos comerciales inválidos.");
}

function parseVariant(value: Record<string, unknown>) {
  if (typeof value.variantId !== "string" || !uuidPattern.test(value.variantId)) throw new Error("Variante inválida.");
  return value.variantId;
}

function parseQuantity(value: Record<string, unknown>) {
  if (!Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 20) throw new Error("La cantidad debe estar entre 1 y 20.");
  return Number(value.quantity);
}

class CommerceRpcError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) { super(message); this.code = code; }
}

async function rpc(context: InstagramCommerceContext, name: string, parameters: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(name, parameters);
  if (error) throw new CommerceRpcError(error.message, error.code);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Supabase devolvió una respuesta comercial inválida.");
  return data as CommerceToolResult;
}

const businessErrors = [
  ["Quantity must be between 1 and 20", "invalid_quantity", "Puedo dejarte entre 1 y 20 unidades de esa variante."],
  ["Accumulated quantity exceeds 20", "quantity_limit_exceeded", "No puedo dejar más de 20 unidades de la misma variante en el carrito."],
  ["Cart item not found", "cart_item_not_found", "Esa variante no está en tu carrito."],
  ["Open cart not found", "open_cart_not_found", "Todavía no tienes un carrito abierto; primero tenemos que elegir una variante."],
  ["Cart is empty", "empty_cart", "Tu carrito está vacío. Agreguemos una variante antes de armar el pedido."],
  ["Product or variant is unavailable", "unavailable", "Esa variante ya no está disponible para agregar."],
] as const;

async function insufficientStockResult(context: InstagramCommerceContext, variantId: string, operation: CommerceToolName, requestedQuantity: number | null) {
  const { data: variant, error } = await context.supabase.from("product_variants")
    .select("id,color,size,stock,products(name)").eq("id", variantId).single();
  if (error || !variant || typeof variant.stock !== "number") throw new Error(`No se pudo releer el stock real: ${error?.message ?? "variante inexistente"}`);
  const cart = await rpc(context, "get_instagram_cart", { p_external_user_id: context.externalUserId });
  const items = Array.isArray(cart.items) ? cart.items as Record<string, unknown>[] : [];
  const cartItem = items.find((item) => item.variantId === variantId);
  const cartQuantity = typeof cartItem?.quantity === "number" ? cartItem.quantity : 0;
  const related = variant.products as { name?: unknown } | { name?: unknown }[] | null;
  const productName = Array.isArray(related) ? related[0]?.name : related?.name;
  const label = [typeof productName === "string" ? productName : "esa variante", typeof variant.color === "string" ? variant.color : null, typeof variant.size === "string" && variant.size ? `talla ${variant.size}` : null].filter(Boolean).join(" ");
  const stock = variant.stock;
  let customerMessage: string;
  if (operation === "add_to_cart" && requestedQuantity === 1 && cartQuantity >= stock && stock > 0) {
    customerMessage = `No puedo agregar otra unidad de ${label} porque ${stock === 1 ? "queda 1 unidad disponible y ya la tienes" : `quedan ${stock} unidades disponibles y ya las tienes`} en el carrito.`;
  } else {
    customerMessage = `No puedo aplicar esa cantidad a ${label}. ${stock === 1 ? "Queda 1 unidad disponible" : `Hay ${stock} unidades disponibles`}${cartQuantity > 0 ? ` y actualmente tienes ${cartQuantity} en el carrito` : ""}.`;
  }
  return { status: "business_error", errorType: "business", code: "insufficient_stock", customerMessage, variantId, currentStock: stock, cartQuantity, requestedQuantity } satisfies CommerceToolResult;
}

async function translateBusinessError(context: InstagramCommerceContext, name: CommerceToolName, error: unknown, variantId?: string, quantity?: number | null) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Insufficient stock") && variantId) return insufficientStockResult(context, variantId, name, quantity ?? null);
  if (message.includes("La cantidad debe estar entre 1 y 20")) return { status: "business_error", errorType: "business", code: "invalid_quantity", customerMessage: "Puedo dejarte entre 1 y 20 unidades de esa variante." } satisfies CommerceToolResult;
  for (const [databaseMessage, code, customerMessage] of businessErrors) {
    if (message.includes(databaseMessage)) return { status: "business_error", errorType: "business", code, customerMessage } satisfies CommerceToolResult;
  }
  throw error;
}

export async function executeCommerceTool(context: InstagramCommerceContext, name: CommerceToolName, input: unknown) {
  let variant: string | undefined;
  let quantity: number | null | undefined;
  try {
    const value = objectInput(input);
    if (name === "view_cart") {
      exactKeys(value, []);
      return await rpc(context, "get_instagram_cart", { p_external_user_id: context.externalUserId });
    }

    await context.authorizeMutation();
    if (name === "create_order") {
      exactKeys(value, []);
      return await rpc(context, "create_instagram_order", { p_external_user_id: context.externalUserId, p_event_id: context.eventId });
    }

    const requiresQuantity = name === "add_to_cart" || name === "set_cart_quantity";
    exactKeys(value, requiresQuantity ? ["variantId", "quantity"] : ["variantId"]);
    variant = parseVariant(value);
    quantity = requiresQuantity ? parseQuantity(value) : null;
    return await rpc(context, "mutate_instagram_cart", {
      p_external_user_id: context.externalUserId,
      p_event_id: context.eventId,
      p_operation_key: `${name}:${variant}`,
      p_operation_type: name,
      p_variant_id: variant,
      p_quantity: quantity,
    });
  } catch (error) {
    return translateBusinessError(context, name, error, variant, quantity);
  }
}

export function isCommerceToolName(name: string): name is CommerceToolName {
  return ["add_to_cart", "view_cart", "remove_from_cart", "set_cart_quantity", "create_order"].includes(name);
}
