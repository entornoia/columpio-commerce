export type WebCartItem = {
  itemId: string;
  productId: string;
  variantId: string;
  name: string;
  slug: string;
  brandSlug: string;
  color: string;
  size: string;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  available: boolean;
};

export type WebCart = {
  cartId: string | null;
  currency: "CLP";
  count: number;
  estimatedTotal: number;
  items: WebCartItem[];
};

export const EMPTY_WEB_CART: WebCart = { cartId: null, currency: "CLP", count: 0, estimatedTotal: 0, items: [] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function positiveQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("La cantidad debe ser un entero mayor a cero.");
  return quantity;
}

export function uuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} inválido.`);
  return value;
}

export function mapWebCart(value: unknown): WebCart {
  if (!value || typeof value !== "object") return EMPTY_WEB_CART;
  const row = value as Record<string, unknown>;
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items = rawItems.map((entry) => {
    const item = entry as Record<string, unknown>;
    return {
      itemId: String(item.itemId ?? ""), productId: String(item.productId ?? ""), variantId: String(item.variantId ?? ""),
      name: String(item.name ?? ""), slug: String(item.slug ?? ""), brandSlug: String(item.brandSlug ?? "mujer"),
      color: String(item.color ?? ""), size: String(item.size ?? ""), imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : null,
      unitPrice: Number(item.unitPrice) || 0, quantity: Number(item.quantity) || 0, subtotal: Number(item.subtotal) || 0,
      available: item.available === true,
    } satisfies WebCartItem;
  });
  return { cartId: typeof row.cartId === "string" ? row.cartId : null, currency: "CLP", count: Number(row.count) || 0, estimatedTotal: Number(row.estimatedTotal) || 0, items };
}
