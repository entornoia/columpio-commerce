export type WebPaymentResult = {
  orderNumber: string;
  orderStatus: string;
  paymentStatus: string;
  total: number;
  currency: "CLP";
  stockException: boolean;
};

export function validatePaymentRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Solicitud de pago inválida.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !["orderId", "idempotencyKey"].includes(key))) throw new Error("La solicitud contiene campos no permitidos.");
  if (typeof row.orderId !== "string" || typeof row.idempotencyKey !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.orderId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.idempotencyKey)) throw new Error("Identidad de pago inválida.");
  return { orderId: row.orderId, idempotencyKey: row.idempotencyKey };
}
