import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export type AdminOrderListItem = {
  id: string; orderNumber: string; createdAt: string; customerName: string; email: string;
  total: number; paymentStatus: string; orderStatus: string; fulfillmentStatus: string;
  deliveryType: "pickup" | "shipping"; stockException: boolean;
};

export type AdminOrderDetail = AdminOrderListItem & {
  currency: string; itemsSubtotal: number; discountTotal: number; shippingTotal: number;
  paidAt: string | null; updatedAt: string; customer: Record<string, unknown>;
  address: Record<string, unknown>; shippingSnapshot: unknown; promotionSnapshot: unknown;
  items: Record<string, unknown>[]; discounts: Record<string, unknown>[];
  payment: Record<string, unknown> | null; attempts: Record<string, unknown>[];
  paymentEvents: Record<string, unknown>[]; reservation: Record<string, unknown> | null;
  reservationItems: Record<string, unknown>[]; adminEvents: Record<string, unknown>[];
};

type Row = Record<string, unknown>;
const one = (value: unknown): Row | null => Array.isArray(value) ? (value[0] as Row | undefined) ?? null : (value as Row | null);
const text = (value: unknown) => typeof value === "string" ? value : "";
const number = (value: unknown) => Number(value ?? 0);

function mapListRow(row: Row): AdminOrderListItem {
  const customer = one(row.web_order_customers) ?? {};
  const address = one(row.web_order_addresses) ?? {};
  const payment = one(row.web_payments) ?? {};
  return {
    id: text(row.id), orderNumber: text(row.order_number), createdAt: text(row.created_at),
    customerName: `${text(customer.first_name)} ${text(customer.last_name)}`.trim(), email: text(customer.email),
    total: number(row.total), paymentStatus: text(payment.status) || "sin_pago", orderStatus: text(row.status),
    fulfillmentStatus: text(row.fulfillment_status), deliveryType: text(address.delivery_type) === "shipping" ? "shipping" : "pickup",
    stockException: payment.stock_exception === true,
  };
}

const LIST_SELECT = "id,order_number,created_at,total,status,fulfillment_status,web_order_customers(email,first_name,last_name),web_order_addresses(delivery_type),web_payments(status,stock_exception)";

export async function listAdminOrders(): Promise<AdminOrderListItem[]> {
  const { data, error } = await createServiceClient().from("web_orders").select(LIST_SELECT).order("created_at", { ascending: false }).limit(250);
  if (error) throw new Error("No se pudieron cargar los pedidos.");
  return ((data ?? []) as unknown as Row[]).map(mapListRow);
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const db = createServiceClient();
  const orderResult = await db.from("web_orders").select(LIST_SELECT + ",currency,items_subtotal,discount_total,shipping_total,paid_at,updated_at,shipping_snapshot,promotion_snapshot").eq("id", id).maybeSingle();
  if (orderResult.error) throw new Error("No se pudo cargar el pedido.");
  if (!orderResult.data) return null;
  const [customer,address,items,discounts,payment,reservation,adminEvents] = await Promise.all([
    db.from("web_order_customers").select("email,first_name,last_name,phone,created_at").eq("order_id",id).maybeSingle(),
    db.from("web_order_addresses").select("delivery_type,recipient_name,phone,street,street_number,complement,region_code,region_name,commune,postal_code,delivery_instructions,created_at").eq("order_id",id).maybeSingle(),
    db.from("web_order_items").select("id,product_name,product_slug,product_sku,variant_sku,brand,category,color,size,image_url,quantity,list_unit_price,unit_discount,final_unit_price,line_subtotal,promotion_snapshot,created_at").eq("order_id",id).order("created_at"),
    db.from("web_order_discounts").select("id,name,discount_type,discount_percentage,code,amount,eligibility_snapshot,created_at").eq("order_id",id).order("created_at"),
    db.from("web_payments").select("id,provider,status,amount,currency,stock_exception,stock_exception_at,paid_at,failed_at,refunded_at,created_at,updated_at").eq("order_id",id).maybeSingle(),
    db.from("web_stock_reservations").select("id,status,expires_at,consumed_at,released_at,release_reason,created_at,updated_at").eq("order_id",id).maybeSingle(),
    db.from("web_order_admin_events").select("id,event_type,from_status,to_status,actor_user_id,note,created_at").eq("order_id",id).order("created_at",{ascending:false}),
  ]);
  const failure = [customer,address,items,discounts,payment,reservation,adminEvents].find((result) => result.error);
  if (failure?.error) throw new Error("No se pudo reconstruir el detalle histórico del pedido.");
  const paymentRow = payment.data as Row | null;
  const reservationRow = reservation.data as Row | null;
  const [attempts,events,reservationItems] = await Promise.all([
    paymentRow ? db.from("web_payment_attempts").select("id,attempt_number,status,provider_order_id,commerce_order,error_code,error_message,created_at,updated_at").eq("payment_id",text(paymentRow.id)).order("attempt_number",{ascending:false}) : Promise.resolve({data:[],error:null}),
    paymentRow ? db.from("web_payment_events").select("id,event_type,provider_status,received_at,processed_at").eq("payment_id",text(paymentRow.id)).order("received_at",{ascending:false}) : Promise.resolve({data:[],error:null}),
    reservationRow ? db.from("web_stock_reservation_items").select("variant_id,quantity,created_at").eq("reservation_id",text(reservationRow.id)) : Promise.resolve({data:[],error:null}),
  ]);
  if (attempts.error || events.error || reservationItems.error) throw new Error("No se pudo cargar la trazabilidad del pedido.");
  const row = orderResult.data as unknown as Row;
  return {
    ...mapListRow(row), currency:text(row.currency), itemsSubtotal:number(row.items_subtotal), discountTotal:number(row.discount_total),
    shippingTotal:number(row.shipping_total), paidAt:text(row.paid_at)||null, updatedAt:text(row.updated_at),
    customer:(customer.data ?? {}) as Row, address:(address.data ?? {}) as Row,
    shippingSnapshot:row.shipping_snapshot, promotionSnapshot:row.promotion_snapshot,
    items:(items.data ?? []) as Row[], discounts:(discounts.data ?? []) as Row[], payment:paymentRow,
    attempts:(attempts.data ?? []) as Row[], paymentEvents:(events.data ?? []) as Row[], reservation:reservationRow,
    reservationItems:(reservationItems.data ?? []) as Row[], adminEvents:(adminEvents.data ?? []) as Row[],
  };
}
