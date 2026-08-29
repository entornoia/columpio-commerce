import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommerceToolResult } from "./types.ts";

export type CommerceSnapshot = {
  focusedProduct: { id: string; name: string } | null;
  focusedVariant: { id: string; productId: string; color: string; size: string; stock: number } | null;
  selectedItems: Array<Record<string, unknown>>;
  selectedQuantity: number;
  selectionTotal: number;
  selection: CommerceToolResult;
  latestOrder: CommerceToolResult | null;
  latestOrderStatus: string | null;
  flowCheckoutStatus: "creating" | "ready" | "failed" | "uncertain" | null;
  payerEmailPresent: boolean;
  paymentUrlPresent: boolean;
  paymentUrl: string | null;
};

function technical(message: string): never { throw new Error(`Snapshot comercial inconsistente: ${message}`); }
function number(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) return technical(`${field} inválido`);
  return parsed;
}

export async function loadCommerceSnapshot(supabase: SupabaseClient, externalUserId: string, focus?: { productId: string | null; variantId: string | null }): Promise<CommerceSnapshot> {
  const { data: conversation, error: conversationError } = await supabase.from("instagram_conversations")
    .select("id").eq("channel", "instagram").eq("external_user_id", externalUserId).single();
  if (conversationError || !conversation || typeof conversation.id !== "string") throw new Error(`No se pudo cargar el snapshot comercial: ${conversationError?.message ?? "conversación inexistente"}`);

  const { data: selectionData, error: selectionError } = await supabase.rpc("get_instagram_cart", { p_external_user_id: externalUserId });
  if (selectionError || !selectionData || typeof selectionData !== "object" || Array.isArray(selectionData)) throw new Error(`No se pudo cargar la selección comercial: ${selectionError?.message ?? "respuesta inválida"}`);
  const selection = selectionData as CommerceToolResult;
  const selectedItems = Array.isArray(selection.items) ? selection.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
  const selectedQuantity = selectedItems.reduce((sum, item, index) => sum + number(item.quantity, `cantidad ${index + 1}`), 0);
  const selectionTotal = number(selection.subtotal ?? 0, "total de selección");

  let focusedProduct: CommerceSnapshot["focusedProduct"] = null;
  let focusedVariant: CommerceSnapshot["focusedVariant"] = null;
  if (focus?.productId) {
    const { data, error } = await supabase.from("products").select("id, name").eq("id", focus.productId).eq("active", true).maybeSingle();
    if (error) throw new Error(`No se pudo cargar el producto focal: ${error.message}`);
    if (data && typeof data.id === "string" && typeof data.name === "string") focusedProduct = { id: data.id, name: data.name };
  }
  if (focus?.variantId) {
    const { data, error } = await supabase.from("product_variants").select("id, product_id, color, size, stock").eq("id", focus.variantId).eq("active", true).maybeSingle();
    if (error) throw new Error(`No se pudo cargar la variante focal: ${error.message}`);
    if (data && typeof data.id === "string" && typeof data.product_id === "string" && typeof data.color === "string" && typeof data.size === "string" && Number.isInteger(data.stock)) focusedVariant = { id: data.id, productId: data.product_id, color: data.color, size: data.size, stock: data.stock };
  }

  const { data: orderRow, error: orderError } = await supabase.from("commerce_orders")
    .select("id, order_number, status, currency, subtotal, total, created_at, commerce_order_items(product_id, variant_id, product_name, product_sku, variant_sku, color, size, quantity, unit_price, subtotal)")
    .eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (orderError) throw new Error(`No se pudo cargar el pedido comercial: ${orderError.message}`);

  let latestOrder: CommerceToolResult | null = null;
  if (orderRow) {
    const orderItems = Array.isArray(orderRow.commerce_order_items) ? orderRow.commerce_order_items.map((item) => ({
      productId: item.product_id, variantId: item.variant_id, productName: item.product_name, productSku: item.product_sku,
      variantSku: item.variant_sku, color: item.color, size: item.size, quantity: number(item.quantity, "cantidad de pedido"),
      unitPrice: number(item.unit_price, "precio de pedido"), subtotal: number(item.subtotal, "subtotal de pedido"),
    })) : [];
    latestOrder = {
      status: "order_created", orderId: orderRow.id, orderNumber: orderRow.order_number, orderStatus: orderRow.status,
      currency: orderRow.currency, subtotal: number(orderRow.subtotal, "subtotal del pedido"), total: number(orderRow.total, "total del pedido"), items: orderItems,
    };
  }

  let flowCheckoutStatus: CommerceSnapshot["flowCheckoutStatus"] = null;
  let payerEmailPresent = false; let paymentUrl: string | null = null;
  if (orderRow) {
    const { data: checkout, error: checkoutError } = await supabase.from("commerce_flow_checkouts")
      .select("status, payer_email, payment_url").eq("provider", "flow").eq("order_id", orderRow.id).maybeSingle();
    if (checkoutError) throw new Error(`No se pudo cargar el checkout Flow: ${checkoutError.message}`);
    if (checkout) {
      flowCheckoutStatus = checkout.status as CommerceSnapshot["flowCheckoutStatus"];
      payerEmailPresent = typeof checkout.payer_email === "string" && checkout.payer_email.trim().length > 0;
      paymentUrl = typeof checkout.payment_url === "string" && checkout.payment_url.trim().length > 0 ? checkout.payment_url : null;
    }
  }

  return {
    focusedProduct, focusedVariant, selectedItems, selectedQuantity, selectionTotal, selection, latestOrder,
    latestOrderStatus: typeof orderRow?.status === "string" ? orderRow.status : null,
    flowCheckoutStatus, payerEmailPresent, paymentUrlPresent: paymentUrl !== null, paymentUrl,
  };
}
