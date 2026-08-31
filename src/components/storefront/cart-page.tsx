"use client";
/* eslint-disable @next/next/no-img-element -- URLs públicas de Storage se validan server-side y aún no se configura next/image. */

import Link from "next/link";
import { useCart } from "./cart-provider";
import { productPath } from "@/lib/storefront/urls";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function CartPage() {
  const { cart, loading, error, setQuantity, remove, clear } = useCart();
  return <section className="store-cart-page"><p className="store-kicker">TU SELECCIÓN</p><h1>Carrito</h1>{error && <p className="store-cart-error">{error}</p>}{!loading && cart.items.length === 0 ? <div className="store-cart-page-empty"><p>Aún no agregas prendas.</p><Link href="/coleccion/chaquetas">Ver colección</Link></div> : <div className="store-cart-layout"><div>{cart.items.map((item) => <article className="store-cart-row" key={item.itemId}><div className="store-cart-row-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name}/> : <span>COL</span>}</div><div className="store-cart-row-copy"><Link href={productPath(item.slug)}>{item.name}</Link><small>{item.color} · Talla {item.size}</small><strong>{money.format(item.unitPrice)}</strong>{!item.available && <em>La disponibilidad cambió. Ajusta o elimina esta prenda.</em>}<div><button disabled={item.quantity <= 1 || loading} onClick={() => setQuantity(item.itemId, item.quantity - 1)}>−</button><span>{item.quantity}</span><button disabled={loading} onClick={() => setQuantity(item.itemId, item.quantity + 1)}>+</button><button className="store-cart-remove" onClick={() => remove(item.itemId)}>Eliminar</button></div></div><strong>{money.format(item.subtotal)}</strong></article>)}{cart.items.length > 0 && <button className="store-cart-clear" onClick={clear}>Vaciar carrito</button>}</div>{cart.items.length > 0 && <aside className="store-cart-summary"><h2>Resumen</h2><p><span>Total estimado</span><strong>{money.format(cart.estimatedTotal)}</strong></p><small>Promociones, despacho y total definitivo se calcularán en el próximo bloque de checkout.</small><button disabled>Continuar al checkout</button></aside>}</div>}</section>;
}
