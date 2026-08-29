import type { InstagramConversationContext } from "../channels/instagram/conversation-state.ts";
import { resolvePurchase, type ContextualSalesResolution, type FocusedProduct } from "../channels/instagram/sales-context.ts";
import type { CommerceSnapshot } from "./commerce-snapshot.ts";
import { formatCommerceResponse } from "./response-formatter.ts";

function selectionConfirmation(snapshot: CommerceSnapshot): ContextualSalesResolution {
  if (snapshot.selectedItems.length === 0) return { kind: "snapshot_response", response: "Claro 💛 Primero dime qué producto quieres comprar.", question: null };
  return { kind: "snapshot_response", response: `${formatCommerceResponse("view_cart", snapshot.selection, {})}\n\n¿Cerramos tu pedido así?`, question: "confirm_order" };
}

function paymentForPendingOrder(snapshot: CommerceSnapshot): ContextualSalesResolution {
  const order = snapshot.latestOrder;
  if (!order || snapshot.latestOrderStatus !== "pending_payment") return selectionConfirmation(snapshot);
  if (snapshot.flowCheckoutStatus === "ready" && snapshot.paymentUrlPresent && snapshot.paymentUrl) {
    return { kind: "snapshot_response", response: formatCommerceResponse("create_payment_link", { status: "payment_link_ready", orderNumber: order.orderNumber, paymentUrl: snapshot.paymentUrl }, {}), question: null };
  }
  if (snapshot.flowCheckoutStatus === "creating") return { kind: "snapshot_response", response: "Estoy preparando el link de pago de tu pedido. Inténtalo nuevamente en un momento.", question: null };
  if (snapshot.flowCheckoutStatus === "uncertain") return { kind: "snapshot_response", response: "No pude confirmar el link de pago con Flow. Dejé la operación en revisión para no generar un cobro duplicado.", question: null };
  if (snapshot.payerEmailPresent) return { kind: "tool", tool: "create_payment_link", input: { payerEmail: null } };
  return { kind: "snapshot_response", response: "Perfecto 💛 Para generar tu link de pago necesito tu correo. ¿Me lo compartes?", question: "ask_email" };
}

export function resolveCommerceAction(action: "pay" | "close" | "summary", snapshot: CommerceSnapshot | null, product: FocusedProduct | null, context: InstagramConversationContext): ContextualSalesResolution {
  if (!snapshot) return { kind: "snapshot_response", response: "No pude consultar tu pedido en este momento.", question: null };
  if (action === "summary") {
    if (snapshot.latestOrder && snapshot.latestOrderStatus === "pending_payment") return { kind: "snapshot_response", response: formatCommerceResponse("create_order", snapshot.latestOrder, {}), question: null };
    if (snapshot.selectedItems.length > 0) return { kind: "snapshot_response", response: formatCommerceResponse("view_cart", snapshot.selection, {}), question: null };
    return { kind: "snapshot_response", response: "Todavía no tienes piezas seleccionadas.", question: null };
  }
  if (snapshot.latestOrderStatus === "pending_payment") return paymentForPendingOrder(snapshot);
  if (snapshot.selectedItems.length > 0) return selectionConfirmation(snapshot);
  return action === "close" ? resolvePurchase(product, context) : { kind: "snapshot_response", response: "Claro 💛 Primero dime qué producto quieres comprar.", question: null };
}
