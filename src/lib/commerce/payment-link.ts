import { assertFlowOperationalConfig, createFlowGateway, flowCallbackUrls, FlowRequestError, type FlowCheckout, type FlowCreatePaymentPayload, type FlowGateway } from "../payments/flow.ts";
import type { CommerceToolResult, InstagramCommerceContext } from "./types";

type OrderItem = {
  variantId: string; productName: string; productSku: string; variantSku: string;
  color: string; size: string; quantity: number; unitPrice: number; subtotal: number;
};

type ClaimedOrder = {
  status: string; claimOwned: boolean; claimId: string | null; claimToken: string | null;
  orderId: string; orderNumber: string; orderStatus: string; currency: string;
  subtotal: number; total: number; items: OrderItem[]; payerEmail: string | null;
  flowOrder?: number | null; flowToken?: string | null; paymentUrl?: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_REQUEST = "Perfecto 💛 Para generar tu link de pago necesito tu correo. ¿Me lo compartes?";
const UNCERTAIN_MESSAGE = "No pude confirmar el link de pago con Flow. Dejé la operación en revisión para no generar un cobro duplicado.";

function technical(message: string): never { throw new Error(`Checkout Flow inconsistente: ${message}`); }
function requiredText(value: unknown, field: string) { return typeof value === "string" && value.trim() ? value.trim() : technical(`falta ${field}`); }
function money(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return technical(`${field} inválido`);
  return value;
}

function validateClaim(value: CommerceToolResult): ClaimedOrder {
  const rawItems = value.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) return technical("el pedido no tiene items");
  const items = rawItems.map((raw, index): OrderItem => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return technical(`item ${index + 1} inválido`);
    const item = raw as Record<string, unknown>;
    const quantity = money(item.quantity, `quantity ${index + 1}`);
    const unitPrice = money(item.unitPrice, `unitPrice ${index + 1}`);
    const subtotal = money(item.subtotal, `subtotal ${index + 1}`);
    if (quantity < 1 || unitPrice < 1 || quantity * unitPrice !== subtotal) return technical(`snapshot del item ${index + 1} inválido`);
    return {
      variantId: requiredText(item.variantId, `variantId ${index + 1}`), productName: requiredText(item.productName, `productName ${index + 1}`),
      productSku: requiredText(item.productSku, `productSku ${index + 1}`), variantSku: requiredText(item.variantSku, `variantSku ${index + 1}`),
      color: requiredText(item.color, `color ${index + 1}`), size: requiredText(item.size, `size ${index + 1}`), quantity, unitPrice, subtotal,
    };
  });
  const subtotal = money(value.subtotal, "subtotal");
  const total = money(value.total, "total");
  if (items.reduce((sum, item) => sum + item.subtotal, 0) !== subtotal) return technical("la suma de items no coincide con subtotal");
  if (subtotal !== total) return technical("subtotal y total no coinciden");
  if (requiredText(value.currency, "currency") !== "CLP") return technical("la moneda no es CLP");
  if (requiredText(value.orderStatus, "orderStatus") !== "pending_payment") return technical("el pedido no está pending_payment");
  const status = requiredText(value.status, "status");
  return {
    status, claimOwned: value.claimOwned === true,
    claimId: typeof value.claimId === "string" ? value.claimId : null,
    claimToken: typeof value.claimToken === "string" ? value.claimToken : null,
    orderId: requiredText(value.orderId, "orderId"), orderNumber: requiredText(value.orderNumber, "orderNumber"),
    orderStatus: "pending_payment", currency: "CLP", subtotal, total, items,
    payerEmail: typeof value.payerEmail === "string" && EMAIL_PATTERN.test(value.payerEmail) ? value.payerEmail : null,
    flowOrder: typeof value.flowOrder === "number" ? value.flowOrder : null,
    flowToken: typeof value.flowToken === "string" ? value.flowToken : null,
    paymentUrl: typeof value.paymentUrl === "string" ? value.paymentUrl : null,
  };
}

export function buildFlowPayment(order: ClaimedOrder): FlowCreatePaymentPayload {
  if (!order.payerEmail) return technical("falta payerEmail");
  const callbacks = flowCallbackUrls();
  return {
    commerceOrder: order.orderId,
    subject: `Pedido ${order.orderNumber}`,
    currency: "CLP",
    amount: order.total,
    email: order.payerEmail,
    paymentMethod: 9,
    ...callbacks,
    optional: JSON.stringify({ orderId: order.orderId, orderNumber: order.orderNumber, channel: "instagram" }),
  };
}

async function rpc(context: InstagramCommerceContext, name: string, parameters: Record<string, unknown>) {
  const { data, error } = await context.supabase.rpc(name, parameters);
  if (error) throw new Error(error.message);
  if (data === null || data === undefined) return null;
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("Supabase devolvió una respuesta de pago inválida.");
  return data as CommerceToolResult;
}

async function complete(context: InstagramCommerceContext, order: ClaimedOrder, checkout: FlowCheckout) {
  const result = await rpc(context, "complete_flow_checkout", {
    p_claim_id: order.claimId, p_claim_token: order.claimToken, p_flow_order: checkout.flowOrder,
    p_flow_token: checkout.token, p_payment_url: checkout.paymentUrl,
  });
  if (!result) return technical("no se pudo persistir el checkout");
  return { ...result, orderId: order.orderId, orderNumber: order.orderNumber, orderStatus: order.orderStatus, currency: order.currency, subtotal: order.subtotal, total: order.total, items: order.items } satisfies CommerceToolResult;
}

async function markFailure(context: InstagramCommerceContext, order: ClaimedOrder, errorCode: string, uncertain: boolean) {
  if (!order.claimId || !order.claimToken) return;
  await rpc(context, "fail_flow_checkout", { p_claim_id: order.claimId, p_claim_token: order.claimToken, p_error_code: errorCode, p_uncertain: uncertain });
}

const emailBusinessResult = () => ({ status: "business_error", errorType: "business", code: "payer_email_required", customerMessage: EMAIL_REQUEST } satisfies CommerceToolResult);
const uncertainBusinessResult = () => ({ status: "business_error", errorType: "business", code: "payment_link_uncertain", customerMessage: UNCERTAIN_MESSAGE } satisfies CommerceToolResult);

export async function createPaymentLink(context: InstagramCommerceContext, payerEmail: string | null) {
  assertFlowOperationalConfig();
  const normalizedEmail = typeof payerEmail === "string" && EMAIL_PATTERN.test(payerEmail.trim()) ? payerEmail.trim().toLowerCase() : null;
  const claimed = await rpc(context, "claim_flow_checkout", { p_external_user_id: context.externalUserId, p_payer_email: normalizedEmail });
  if (!claimed) return technical("no se pudo reclamar el checkout");
  if (claimed.status === "payer_email_required") return emailBusinessResult();
  const order = validateClaim(claimed);
  if (order.status === "payment_link_ready") {
    if (!order.flowOrder || !order.flowToken || !order.paymentUrl) return technical("checkout ready incompleto");
    return { ...claimed, status: "payment_link_ready" } satisfies CommerceToolResult;
  }
  if (order.status === "payment_link_uncertain") return uncertainBusinessResult();
  if (!order.claimOwned || !order.claimId || !order.claimToken) return { status: "business_error", errorType: "business", code: "payment_link_processing", customerMessage: "Estoy preparando el link de pago de tu pedido. Inténtalo nuevamente en un momento." } satisfies CommerceToolResult;

  const gateway: FlowGateway = context.flowGateway ?? createFlowGateway();
  try {
    const existing = await gateway.findByCommerceOrder(order.orderId);
    if (existing) {
      await markFailure(context, order, `existing_flow_order_${existing.flowOrder}`, true);
      return uncertainBusinessResult();
    }
    return await complete(context, order, await gateway.createPayment(buildFlowPayment(order)));
  } catch (error) {
    const uncertain = error instanceof FlowRequestError ? error.uncertain : true;
    if (uncertain) {
      try {
        const existing = await gateway.findByCommerceOrder(order.orderId);
        await markFailure(context, order, existing ? `existing_flow_order_${existing.flowOrder}` : error instanceof FlowRequestError ? error.code : "unknown", true);
      } catch {
        await markFailure(context, order, error instanceof FlowRequestError ? error.code : "unknown", true);
      }
      return uncertainBusinessResult();
    }
    await markFailure(context, order, error instanceof FlowRequestError ? error.code : "flow_error", false);
    throw error;
  }
}
