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
