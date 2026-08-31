"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useCart } from "./cart-provider";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
type Result = { orderId: string; orderNumber: string; status: string; total: number; reservationExpiresAt: string };

export function CheckoutPage() {
  const { cart, loading } = useCart();
  const [regions, setRegions] = useState<{code:string;name:string}[]>([]); const [deliveryType, setDeliveryType] = useState<"pickup"|"shipping">("pickup");
  const [regionCode, setRegionCode] = useState(""); const [commune, setCommune] = useState(""); const [shipping, setShipping] = useState(0);
  const [submitting, setSubmitting] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState<Result|null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  useEffect(() => { fetch("/api/storefront/shipping").then((r) => r.json()).then((data) => setRegions(data.regions ?? [])).catch(() => setError("No pudimos cargar las regiones.")); }, []);
  useEffect(() => {
    if (deliveryType === "shipping" && !regionCode) return;
    const controller = new AbortController(); fetch("/api/storefront/shipping", { method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({method:deliveryType === "pickup"?"pickup":"shipping",regionCode:regionCode||null,commune:commune||null}),signal:controller.signal })
      .then(async(r)=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setShipping(Number(data.amount)||0);}).catch((cause)=>{if(cause.name!=="AbortError")setError(cause.message);}); return()=>controller.abort();
  },[deliveryType,regionCode,commune]);
  if (result) return <section className="store-checkout-page"><div className="store-checkout-success"><p className="store-kicker">CHECKOUT CREADO</p><h2>Pedido creado — pago aún no habilitado</h2><strong>{result.orderNumber}</strong><p>Total: {money.format(result.total)}</p><p>Reserva válida hasta {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short"}).format(new Date(result.reservationExpiresAt))}.</p><Link href="/">Volver a la tienda</Link></div></section>;
  if (!loading && cart.items.length === 0) return <section className="store-checkout-page"><h1>Checkout</h1><p>Tu carrito está vacío o ya inició checkout.</p><Link href="/">Volver a la tienda</Link></section>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(""); const form = new FormData(event.currentTarget);
    const payload = { idempotencyKey, customer:{firstName:form.get("firstName"),lastName:form.get("lastName"),email:form.get("email"),phone:form.get("phone")},deliveryType,address:deliveryType==="shipping"?{regionCode,commune,street:form.get("street"),number:form.get("number"),complement:form.get("complement"),instructions:form.get("instructions")}:undefined,discountCode:cart.discountCode };
    try { const response=await fetch("/api/storefront/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw new Error(data.error);setResult(data); }
    catch(cause){setError(cause instanceof Error?cause.message:"No pudimos crear el pedido.");}finally{setSubmitting(false);}
  }
  return <section className="store-checkout-page"><p className="store-kicker">COMPRA SEGURA</p><h1>Checkout</h1><div className="store-checkout-grid"><form className="store-checkout-form" onSubmit={submit}>
    <label><span>Nombre</span><input name="firstName" required maxLength={80}/></label><label><span>Apellido</span><input name="lastName" required maxLength={80}/></label>
    <label className="store-checkout-wide"><span>Email</span><input name="email" type="email" required maxLength={254}/></label><label className="store-checkout-wide"><span>Teléfono</span><input name="phone" type="tel" placeholder="+56912345678" required maxLength={16}/></label>
    <div className="store-checkout-delivery"><label><input type="radio" checked={deliveryType==="pickup"} onChange={()=>setDeliveryType("pickup")}/> Retiro</label><label><input type="radio" checked={deliveryType==="shipping"} onChange={()=>setDeliveryType("shipping")}/> Despacho</label></div>
    {deliveryType==="shipping"&&<><label className="store-checkout-wide"><span>Región</span><select required value={regionCode} onChange={(e)=>setRegionCode(e.target.value)}><option value="">Selecciona región</option>{regions.map((item)=><option value={item.code} key={item.code}>{item.name}</option>)}</select></label><label className="store-checkout-wide"><span>Comuna</span><input value={commune} onChange={(e)=>setCommune(e.target.value)} required maxLength={80}/></label><label><span>Calle</span><input name="street" required maxLength={120}/></label><label><span>Número</span><input name="number" required maxLength={20}/></label><label className="store-checkout-wide"><span>Complemento</span><input name="complement" maxLength={120}/></label><label className="store-checkout-wide"><span>Instrucciones de entrega</span><textarea name="instructions" maxLength={300}/></label></>}
    {error&&<p className="store-cart-error store-checkout-wide">{error}</p>}<button className="store-checkout-submit" disabled={submitting||cart.items.some((item)=>!item.available)}>{submitting?"Creando pedido…":"Continuar al pago"}</button>
  </form><aside className="store-checkout-summary"><h2>Tu pedido</h2>{cart.items.map((item)=><p key={item.itemId}><span>{item.quantity} × {item.name}</span><strong>{money.format(item.total)}</strong></p>)}<p><span>Subtotal</span><strong>{money.format(cart.listSubtotal)}</strong></p>{cart.discountAmount>0&&<p><span>Descuento</span><strong>−{money.format(cart.discountAmount)}</strong></p>}<p><span>Despacho</span><strong>{money.format(shipping)}</strong></p><p><span>Total</span><strong>{money.format(cart.productsTotal+shipping)}</strong></p></aside></div></section>;
}
