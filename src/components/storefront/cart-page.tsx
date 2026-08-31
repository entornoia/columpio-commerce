"use client";
/* eslint-disable @next/next/no-img-element -- Storage público; next/image queda fuera de este bloque. */

import Link from "next/link";
import { useEffect, useState } from "react";
import { productPath } from "@/lib/storefront/urls";
import { useCart } from "./cart-provider";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function CartPage() {
  const { cart, loading, error, setQuantity, remove, clear, setDiscountCode } = useCart();
  const [code, setCode] = useState("");
  const [method, setMethod] = useState<"pickup" | "shipping">("pickup");
  const [regions, setRegions] = useState<{ code: string; name: string }[]>([]);
  const [region, setRegion] = useState("");
  const [commune, setCommune] = useState("");
  const [shipping, setShipping] = useState<{ amount: number; zoneName: string } | null>(null);
  const [shippingError, setShippingError] = useState("");

  useEffect(() => {
    fetch("/api/storefront/shipping").then((response) => response.json()).then((data) => setRegions(data.regions ?? []))
      .catch(() => setShippingError("No pudimos cargar las regiones."));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if ((method === "shipping" && !region) || (commune.trim().length === 1)) return () => controller.abort();
    fetch("/api/storefront/shipping", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, regionCode: region || null, commune: commune || null }), signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error); setShippingError(""); setShipping(data);
    }).catch((cause) => {
      if (cause.name !== "AbortError") { setShipping(null); setShippingError(cause.message || "No pudimos calcular el despacho."); }
    });
    return () => controller.abort();
  }, [method, region, commune]);

  const resolvedShipping = method === "shipping" && !region ? null : shipping;
  const estimate = cart.productsTotal + (resolvedShipping?.amount ?? 0);
  return <section className="store-cart-page"><p className="store-kicker">TU SELECCIÓN</p><h1>Carrito</h1>
    {error && <p className="store-cart-error">{error}</p>}
    {!loading && cart.items.length === 0 ? <div className="store-cart-page-empty"><p>Aún no agregas prendas.</p><Link href="/coleccion/chaquetas">Ver colección</Link></div> :
      <div className="store-cart-layout"><div>{cart.items.map((item) => <article className="store-cart-row" key={item.itemId}>
        <div className="store-cart-row-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.name}/> : <span>COL</span>}</div>
        <div className="store-cart-row-copy"><Link href={productPath(item.slug)}>{item.name}</Link><small>{item.color} · Talla {item.size}</small>
          <strong>{money.format(item.unitPrice)}</strong>{item.discountAmount > 0 && <small>Descuento: −{money.format(item.discountAmount)}</small>}
          {!item.available && <em>La disponibilidad cambió. Ajusta o elimina esta prenda.</em>}
          <div><button disabled={item.quantity <= 1 || loading} onClick={() => setQuantity(item.itemId, item.quantity - 1)}>−</button><span>{item.quantity}</span><button disabled={loading} onClick={() => setQuantity(item.itemId, item.quantity + 1)}>+</button><button className="store-cart-remove" onClick={() => remove(item.itemId)}>Eliminar</button></div>
        </div><strong>{money.format(item.total)}</strong></article>)}{cart.items.length > 0 && <button className="store-cart-clear" onClick={clear}>Vaciar carrito</button>}</div>
        {cart.items.length > 0 && <aside className="store-cart-summary"><h2>Resumen</h2>
          <form className="store-cart-code" onSubmit={async (event) => { event.preventDefault(); if (await setDiscountCode(code)) setCode(""); }}><label htmlFor="discount-code">Código promocional</label><div><input id="discount-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={40} placeholder="TU CÓDIGO"/><button disabled={!code.trim() || loading}>Aplicar</button></div>{cart.discountCode && <p><span>{cart.discountCode}</span><button type="button" onClick={() => setDiscountCode(null)}>Quitar</button></p>}</form>
          <div className="store-cart-shipping"><b>Entrega</b><label><input type="radio" checked={method === "pickup"} onChange={() => setMethod("pickup")}/> Retiro</label><label><input type="radio" checked={method === "shipping"} onChange={() => setMethod("shipping")}/> Despacho</label>{method === "shipping" && <><select value={region} onChange={(event) => setRegion(event.target.value)}><option value="">Selecciona región</option>{regions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select><input value={commune} onChange={(event) => setCommune(event.target.value)} maxLength={80} placeholder="Comuna (opcional)"/></>}</div>
          {shippingError && <small className="store-cart-error">{shippingError}</small>}
          <p><span>Subtotal lista</span><strong>{money.format(cart.listSubtotal)}</strong></p>{cart.discountAmount > 0 && <p><span>{cart.promotion?.name ?? "Descuento"}</span><strong>−{money.format(cart.discountAmount)}</strong></p>}<p><span>Total productos</span><strong>{money.format(cart.productsTotal)}</strong></p><p><span>Despacho</span><strong>{resolvedShipping ? money.format(resolvedShipping.amount) : "Por calcular"}</strong></p><p><span>Total estimado</span><strong>{money.format(estimate)}</strong></p>
          <small>Estimación vigente; se recalculará al iniciar checkout.</small><button disabled>Continuar al checkout</button>
        </aside>}</div>}
  </section>;
}
