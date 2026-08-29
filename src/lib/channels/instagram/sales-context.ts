import type { InstagramConversationContext } from "./conversation-state.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ContextualSalesResolution =
  | { kind: "none" }
  | { kind: "clarify"; response: string; question: "ask_size" | "ask_color" | "confirm_quantity" | "confirm_add" | "confirm_order" | "ask_email" | null }
  | { kind: "agent"; text: string }
  | { kind: "attribute"; attribute: ProductAttribute }
  | { kind: "rephrase" }
  | { kind: "purchase" }
  | { kind: "commerce_action"; action: "pay" | "close" | "summary" }
  | { kind: "quantity"; quantity: number }
  | { kind: "snapshot_response"; response: string; question: "confirm_order" | "ask_email" | null }
  | { kind: "variant_query"; value: string }
  | { kind: "tool"; tool: "add_to_cart" | "set_cart_quantity" | "create_order" | "create_payment_link"; input: Record<string, unknown> };

export type ProductAttribute = "material" | "sleeve" | "length" | "fit" | "color" | "size" | "price" | "availability";
export type FocusedProduct = {
  id: string;
  name: string;
  material: string;
  fit: string;
  price: number;
  variants: Array<{ id: string; color: string; size: string; stock: number }>;
};

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL").trim();
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadFocusedVariantLabel(supabase: SupabaseClient, variantId: string) {
  const { data, error } = await supabase.from("product_variants").select("id, color, size, products!inner(id, name)").eq("id", variantId).eq("active", true).maybeSingle();
  if (error || !data) return null;
  const productValue = data.products as unknown;
  const product = Array.isArray(productValue) ? productValue[0] : productValue;
  if (!product || typeof product !== "object" || typeof (product as { name?: unknown }).name !== "string" || typeof data.color !== "string" || typeof data.size !== "string") return null;
  return `${(product as { name: string }).name} ${data.color.toLocaleLowerCase("es-CL")} en ${data.size}`;
}

export async function loadFocusedProductName(supabase: SupabaseClient, productId: string) {
  const { data, error } = await supabase.from("products").select("id, name").eq("id", productId).eq("active", true).maybeSingle();
  return !error && data && typeof data.name === "string" ? data.name : null;
}

export async function loadFocusedProduct(supabase: SupabaseClient, productId: string): Promise<FocusedProduct | null> {
  const { data, error } = await supabase.from("products")
    .select("id, name, material, fit, price, product_variants(id, color, size, stock, active)")
    .eq("id", productId).eq("active", true).maybeSingle();
  if (error || !data || typeof data.id !== "string" || typeof data.name !== "string") return null;
  const price = typeof data.price === "number" ? data.price : Number(data.price);
  if (!Number.isFinite(price) || price < 0) return null;
  const rawVariants = Array.isArray(data.product_variants) ? data.product_variants : [];
  const variants = rawVariants.flatMap((raw) => raw && raw.active === true && typeof raw.id === "string" && typeof raw.color === "string" && typeof raw.size === "string" && Number.isInteger(raw.stock) && raw.stock >= 0
    ? [{ id: raw.id, color: raw.color, size: raw.size, stock: raw.stock }]
    : []);
  return { id: data.id, name: data.name, material: typeof data.material === "string" ? data.material.trim() : "", fit: typeof data.fit === "string" ? data.fit.trim() : "", price, variants };
}

const unique = (values: string[]) => [...new Set(values)];
const joinNatural = (values: string[]) => values.length < 2 ? values[0] ?? "" : `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;
const money = (value: number) => `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)}`;

export function formatProductAttribute(product: FocusedProduct, attribute: ProductAttribute) {
  const available = product.variants.filter((variant) => variant.stock > 0);
  if (attribute === "material" && product.material) return `${product.name} está registrada en ${product.material}.`;
  if (attribute === "fit" && product.fit) return `El calce registrado de ${product.name} es ${product.fit}.`;
  if (attribute === "price") return `${product.name} está a ${money(product.price)}.`;
  if (attribute === "color") {
    const colors = unique(available.map((variant) => variant.color));
    if (colors.length) return `${product.name} está disponible en ${joinNatural(colors)}.`;
  }
  if (attribute === "size") {
    const sizes = unique(available.map((variant) => variant.size));
    if (sizes.length) return `${product.name} está disponible en talla ${joinNatural(sizes)}.`;
  }
  if (attribute === "availability") return available.length
    ? `${product.name} tiene disponibilidad en ${available.map((variant) => `${variant.color} talla ${variant.size}`).join(", ")}.`
    : `${product.name} no tiene variantes con stock disponible en este momento.`;
  return "Ese dato no lo tengo registrado. Sí puedo ayudarte con talla, color, precio y disponibilidad.";
}

export function formatVariantQuery(product: FocusedProduct, requestedValue: string) {
  const requested = normalize(requestedValue);
  const available = product.variants.filter((variant) => variant.stock > 0);
  const colors = available.filter((variant) => normalize(variant.color) === requested);
  if (colors.length) return `${product.name} está disponible en ${colors[0].color}, talla ${joinNatural(unique(colors.map((variant) => variant.size)))}.`;
  const sizes = available.filter((variant) => normalize(variant.size) === requested);
  if (sizes.length) return `${product.name} está disponible en talla ${sizes[0].size}, color ${joinNatural(unique(sizes.map((variant) => variant.color)))}.`;
  return `${product.name} no está registrada en ${requestedValue.trim()}.`;
}

export function rephraseSalesQuestion(context: InstagramConversationContext, product: FocusedProduct | null) {
  const label = product?.name ?? "el producto que vimos";
  if (context.lastAgentQuestion === "ask_size") return `Perdón. Te preguntaba qué talla prefieres para ${label}.`;
  if (context.lastAgentQuestion === "ask_color") return `Perdón. Te preguntaba qué color prefieres para ${label}.`;
  if (context.lastAgentQuestion === "confirm_quantity") return `Perdón. Te preguntaba si quieres dejar solo 1 unidad de ${label}.`;
  if (context.lastAgentQuestion === "confirm_order") return "Perdón. Te preguntaba si quieres cerrar tu pedido con las piezas que elegiste.";
  if (context.lastAgentQuestion === "ask_email") return "Perdón. Para generar el link de pago necesito que me compartas tu correo.";
  if (context.lastAgentQuestion === "confirm_add" || product) return `Perdón. Te preguntaba si quieres seguir viendo opciones o comprar ${label}.`;
  return "Perdón. ¿Qué producto estás buscando?";
}

export function resolvePurchase(product: FocusedProduct | null, context: InstagramConversationContext): ContextualSalesResolution {
  if (["add_item", "set_quantity", "view_selection"].includes(context.lastCommercialAction ?? "")) {
    return { kind: "clarify", response: "Ya tienes piezas seleccionadas. ¿Cerramos tu pedido así?", question: "confirm_order" };
  }
  if (context.lastVariantId) return { kind: "tool", tool: "add_to_cart", input: { variantId: context.lastVariantId, quantity: 1 } };
  if (!product) return { kind: "clarify", response: "¿Qué producto quieres comprar?", question: null };
  const available = product.variants.filter((variant) => variant.stock > 0);
  if (!available.length) return { kind: "clarify", response: `${product.name} no tiene variantes con stock disponible en este momento.`, question: null };
  if (available.length === 1) return { kind: "tool", tool: "add_to_cart", input: { variantId: available[0].id, quantity: 1 } };
  const sizes = unique(available.map((variant) => variant.size));
  if (sizes.length > 1) return { kind: "clarify", response: `Perfecto. ¿Qué talla prefieres: ${joinNatural(sizes)}?`, question: "ask_size" };
  const colors = unique(available.map((variant) => variant.color));
  if (colors.length > 1) return { kind: "clarify", response: `Perfecto. ¿Qué color prefieres: ${joinNatural(colors)}?`, question: "ask_color" };
  return { kind: "tool", tool: "add_to_cart", input: { variantId: available[0].id, quantity: 1 } };
}

function productAttribute(text: string): ProductAttribute | null {
  if (/\b(tela|material|composicion)\b/.test(text)) return "material";
  if (/\b(manga|mangas)\b/.test(text)) return "sleeve";
  if (/\b(largo|longitud)\b/.test(text)) return "length";
  if (/\b(corte|calce|fit)\b/.test(text)) return "fit";
  if (/\b(color|colores)\b/.test(text)) return "color";
  if (/\b(talla|tallas)\b/.test(text)) return "size";
  if (/\b(precio|valor|cuanto cuesta|cuanto sale)\b/.test(text)) return "price";
  if (/\b(disponibilidad|disponible|stock|queda|quedan)\b/.test(text)) return "availability";
  return null;
}

function naturalQuantity(text: string) {
  const match = text.match(/\b(1|2|3|uno|una|dos|tres)\b/);
  if (!match || (!/^(1|2|3|uno|una|dos|tres)$/.test(text) && !/\b(quiero|comprar|dame|dejame|llevo|de esas|de esos|unidades?)\b/.test(text))) return null;
  return match[1] === "1" || match[1] === "uno" || match[1] === "una" ? 1 : match[1] === "2" || match[1] === "dos" ? 2 : 3;
}

export function resolveSalesContinuation(textValue: string | null, context: InstagramConversationContext, fresh: boolean): ContextualSalesResolution {
  if (context.state !== "sales" || !textValue?.trim()) return { kind: "none" };
  const text = normalize(textValue);

  if (!fresh) {
    if (/^(m|s|l|xl|xxl|si|dale|hazlo|ese|esa|lo compro|quiero ese|me llevo ese|uno|solo (quiero )?uno?s?)$/.test(text)) {
      return { kind: "clarify", response: "¿Qué producto quieres retomar? Así confirmo nuevamente la variante disponible.", question: null };
    }
    return { kind: "none" };
  }

  if (/\b(no entiendo|no entendi|que quieres decir|como asi|no te entendi)\b/.test(text)) return { kind: "rephrase" };

  if (context.lastAgentQuestion === "confirm_order" && /^(si|si por favor|dale|hazlo|confirmo|perfecto)\b/.test(text)) return { kind: "tool", tool: "create_order", input: {} };
  const quantity = naturalQuantity(text);
  if (quantity !== null) return { kind: "quantity", quantity };
  if (/\b(quiero pagar|como pago|como debo pagar|como puedo pagar|dime como (debo )?pagar|mandame el link|enviame el link|quiero el link|quiero finalizar)\b/.test(text)) return { kind: "commerce_action", action: "pay" };
  if (/\b(cual es (mi|el) pedido( final)?|que llevo|que tengo (en el pedido|seleccionado)|muestrame (mi|el) pedido|pedido final)\b/.test(text)) return { kind: "commerce_action", action: "summary" };
  if (/\b(quiero comprar|quiero cerrar|cerramos|listo|cerrar (mi|el) pedido|finalizar (mi|el) pedido)\b/.test(text)) return { kind: "commerce_action", action: "close" };

  if (context.lastAgentQuestion === "ask_email" && email.test(text)) return { kind: "tool", tool: "create_payment_link", input: { payerEmail: textValue.trim() } };
  if (context.lastAgentQuestion === "confirm_quantity" && /^(si|si por favor|dale|hazlo|confirmo|perfecto)$/.test(text)) {
    return context.lastVariantId
      ? { kind: "tool", tool: "set_cart_quantity", input: { variantId: context.lastVariantId, quantity: 1 } }
      : { kind: "clarify", response: "¿De cuál pieza quieres dejar solo una unidad?", question: null };
  }
  if (context.lastAgentQuestion === "confirm_add" && /^(si|si por favor|dale|hazlo|confirmo|perfecto)$/.test(text)) {
    return context.lastVariantId
      ? { kind: "tool", tool: "add_to_cart", input: { variantId: context.lastVariantId, quantity: 1 } }
      : { kind: "clarify", response: "¿Qué producto y talla quieres que deje en tu pedido?", question: null };
  }
  const attribute = productAttribute(text);
  if (attribute) return { kind: "attribute", attribute };
  const variantQuery = text.match(/\ben\s+([a-z0-9]+)\s+(la|lo)?\s*(tienes|tienen|hay|queda)?/);
  if (variantQuery?.[1]) return { kind: "variant_query", value: variantQuery[1] };
  if (/\b(como compro|como comprar|la quiero|lo quiero|me la llevo|me lo llevo|quiero esa|quiero ese|quiero comprar esa|quiero comprar ese)\b/.test(text)) return { kind: "purchase" };
  if (/^(uno|solo uno|solo unos|solo quiero uno|solo quiero unos|dejame uno)$/.test(text)) {
    return context.lastVariantId
      ? { kind: "clarify", response: "Perfecto, ¿quieres dejar solo 1 unidad de esa pieza?", question: "confirm_quantity" }
      : { kind: "clarify", response: "¿De cuál pieza quieres dejar solo una unidad?", question: null };
  }
  if (/^(ese|esa|quiero ese|quiero esa|ese me gusta|esa me gusta|lo compro|la compro|me llevo ese|me llevo esa|quiero uno|dejame uno)$/.test(text)) {
    if (context.lastVariantId) return { kind: "tool", tool: "add_to_cart", input: { variantId: context.lastVariantId, quantity: 1 } };
    if (context.lastProductId) return { kind: "clarify", response: "Perfecto. ¿Qué talla quieres?", question: "ask_size" };
    return { kind: "clarify", response: "¿Cuál de las opciones quieres elegir?", question: null };
  }
  if (/^(m|s|l|xl|xxl)$/.test(text) && context.lastAgentQuestion === "ask_size") {
    return { kind: "agent", text: `La clienta eligió talla ${text.toUpperCase()} para el producto que estaba en foco. Confirma la variante real con search_catalog antes de ofrecer agregarla.` };
  }
  if (/^[a-z]+$/.test(text) && context.lastAgentQuestion === "ask_color") {
    return { kind: "agent", text: `La clienta eligió color ${textValue.trim()}. Confirma la variante real con search_catalog antes de ofrecer agregarla.` };
  }
  return { kind: "clarify", response: "¿Qué quieres hacer con tu selección o qué producto quieres seguir viendo?", question: null };
}
