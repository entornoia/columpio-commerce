"use client";
/* eslint-disable @next/next/no-img-element -- URLs públicas de Storage se validan server-side y aún no se configura next/image. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { EMPTY_WEB_CART, type WebCart } from "@/lib/storefront/cart-contract";
import { productPath } from "@/lib/storefront/urls";

type CartContextValue = {
  cart: WebCart; loading: boolean; error: string; drawerOpen: boolean;
  openDrawer(): void; closeDrawer(): void; add(variantId: string, quantity?: number): Promise<boolean>;
  setQuantity(itemId: string, quantity: number): Promise<void>; remove(itemId: string): Promise<void>; clear(): Promise<void>;
  setDiscountCode(code: string | null): Promise<boolean>;
};
const CartContext = createContext<CartContextValue | null>(null);
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

async function cartRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No pudimos actualizar el carrito.");
  return data as WebCart;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [cart, setCart] = useState(EMPTY_WEB_CART);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setCart(await cartRequest("/api/storefront/cart")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos consultar el carrito."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    cartRequest("/api/storefront/cart")
      .then((next) => { if (active) setCart(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "No pudimos consultar el carrito."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pathname]);

  const mutate = useCallback(async (url: string, init: RequestInit) => {
    setLoading(true); setError("");
    try { const next = await cartRequest(url, init); setCart(next); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos actualizar el carrito."); return false; }
    finally { setLoading(false); }
  }, []);
  const value = useMemo<CartContextValue>(() => ({
    cart, loading, error, drawerOpen, async openDrawer() { await refresh(); setDrawerOpen(true); }, closeDrawer: () => setDrawerOpen(false),
    async add(variantId, quantity = 1) { const ok = await mutate("/api/storefront/cart", { method: "POST", body: JSON.stringify({ variantId, quantity }) }); if (ok) setDrawerOpen(true); return ok; },
    async setQuantity(itemId, quantity) { await mutate(`/api/storefront/cart/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ quantity }) }); },
    async remove(itemId) { await mutate(`/api/storefront/cart/items/${itemId}`, { method: "DELETE" }); },
    async clear() { await mutate("/api/storefront/cart", { method: "DELETE" }); },
    async setDiscountCode(code) { return mutate("/api/storefront/cart/discount", { method: code ? "PUT" : "DELETE", body: code ? JSON.stringify({ code }) : undefined }); },
  }), [cart, loading, error, drawerOpen, mutate, refresh]);

  return <CartContext.Provider value={value}>{children}<div className={`store-cart-backdrop ${drawerOpen ? "open" : ""}`} onClick={() => setDrawerOpen(false)}/><aside className={`store-cart-drawer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}><div className="store-cart-drawer-head"><h2>Tu carrito</h2><button onClick={() => setDrawerOpen(false)} aria-label="Cerrar carrito">×</button></div>{error && <p className="store-cart-error">{error}</p>}<div className="store-cart-drawer-items">{cart.items.length === 0 ? <p className="store-cart-empty">Tu carrito está vacío.</p> : cart.items.map((item) => <article className="store-cart-mini" key={item.itemId}><div className="store-cart-mini-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name}/> : <span>COL</span>}</div><div><Link href={productPath(item.slug)} onClick={() => setDrawerOpen(false)}>{item.name}</Link><small>{item.color} · Talla {item.size}</small><span>{item.quantity} × {money.format(item.unitPrice)}</span><button onClick={() => value.remove(item.itemId)}>Eliminar</button>{!item.available && <em>Revisar disponibilidad</em>}</div></article>)}</div>{cart.items.length > 0 && <div className="store-cart-drawer-foot"><p><span>Total estimado</span><strong>{money.format(cart.estimatedTotal)}</strong></p><Link href="/carrito" onClick={() => setDrawerOpen(false)}>Ver carrito</Link></div>}</aside></CartContext.Provider>;
}

export function useCart() {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart debe usarse dentro de CartProvider.");
  return value;
}
