import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { EMPTY_WEB_CART, mapWebCart, type WebCart } from "./cart-contract";

export const CART_COOKIE = "columpio_cart";
export const CART_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};

export function newCartToken() { return randomBytes(32).toString("base64url"); }
export function hashCartToken(token: string) { return createHash("sha256").update(token, "utf8").digest("hex"); }

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(request.url).origin;
  if (!origin || origin !== expected) throw new Error("Origen no permitido.");
}

export async function readCart(token?: string): Promise<WebCart> {
  if (!token) return EMPTY_WEB_CART;
  const { data, error } = await createServiceClient().rpc("get_web_cart", { p_token_hash: hashCartToken(token) });
  if (error) throw new Error("No pudimos consultar el carrito.");
  return mapWebCart(data);
}

export async function mutateCart(input: {
  token?: string;
  operation: "add" | "set_quantity" | "remove" | "clear";
  variantId?: string;
  itemId?: string;
  quantity?: number;
}) {
  const createdToken = input.token ? undefined : newCartToken();
  const token = input.token ?? createdToken!;
  const { data, error } = await createServiceClient().rpc("mutate_web_cart", {
    p_token_hash: hashCartToken(token), p_operation: input.operation,
    p_variant_id: input.variantId ?? null, p_item_id: input.itemId ?? null,
    p_quantity: input.quantity ?? null, p_create_session: Boolean(createdToken && input.operation === "add"),
  });
  if (error) {
    if (/stock/i.test(error.message)) throw new Error("No hay stock suficiente para esa cantidad.");
    if (/variant|available/i.test(error.message)) throw new Error("Esta variante ya no está disponible.");
    throw new Error("No pudimos actualizar el carrito.");
  }
  return { cart: mapWebCart(data), createdToken };
}

export async function setCartDiscountCode(token: string | undefined, code: string | null) {
  if (!token) throw new Error("Agrega una prenda antes de ingresar un código.");
  const normalized = code?.trim().toUpperCase() || null;
  if (normalized && !/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(normalized)) throw new Error("El código promocional no es válido.");
  const { data, error } = await createServiceClient().rpc("set_web_cart_discount_code", { p_token_hash: hashCartToken(token), p_code: normalized });
  if (error) throw new Error(/invalid|inactive/i.test(error.message) ? "El código no existe o ya no está vigente." : "No pudimos aplicar el código.");
  return mapWebCart(data);
}

export type ShippingQuote = { zoneCode: string; zoneName: string; amount: number; currency: "CLP"; method: "pickup" | "shipping" };

export async function listShippingRegions() {
  const { data, error } = await createServiceClient().rpc("list_web_shipping_regions");
  if (error) throw new Error("No pudimos consultar las regiones.");
  return (data ?? []).map((row: Record<string, unknown>) => ({ code: String(row.region_code), name: String(row.region_name) }));
}

export async function resolveShipping(method: unknown, regionCode: unknown, commune: unknown): Promise<ShippingQuote> {
  if (method !== "pickup" && method !== "shipping") throw new Error("Selecciona una modalidad de entrega válida.");
  const region = typeof regionCode === "string" ? regionCode.trim().toUpperCase() : null;
  const communeValue = typeof commune === "string" && commune.trim() ? commune.trim() : null;
  if (method === "shipping" && (!region || !/^CL-[A-Z0-9]{2,3}$/.test(region))) throw new Error("Selecciona una región válida.");
  if (communeValue && (communeValue.length < 2 || communeValue.length > 80)) throw new Error("La comuna no es válida.");
  const { data, error } = await createServiceClient().rpc("resolve_web_shipping", { p_method: method, p_region_code: method === "shipping" ? region : null, p_commune: method === "shipping" ? communeValue : null });
  if (error || !data || typeof data !== "object") throw new Error("No pudimos calcular el despacho.");
  const row = data as Record<string, unknown>;
  return { zoneCode: String(row.zoneCode), zoneName: String(row.zoneName), amount: Number(row.amount) || 0, currency: "CLP", method };
}
