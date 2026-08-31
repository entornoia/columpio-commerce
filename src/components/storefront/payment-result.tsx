"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WebPaymentResult } from "@/lib/storefront/payment-contract";

const money=new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0});
const terminal=new Set(["paid","payment_failed","cancelled","expired","payment_review"]);
export function PaymentResult(){const[result,setResult]=useState<WebPaymentResult|null>(null),[error,setError]=useState("");
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;async function poll(){try{const response=await fetch("/api/storefront/payment/status",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error);if(!active)return;setResult(data);if(!terminal.has(data.orderStatus))timer=setTimeout(poll,2500);}catch(cause){if(active)setError(cause instanceof Error?cause.message:"No pudimos consultar tu pago.");}}void poll();return()=>{active=false;clearTimeout(timer);};},[]);
  const heading=!result?"Estamos confirmando tu pago":result.orderStatus==="paid"?"Pago confirmado":result.orderStatus==="payment_review"?"Pago recibido — revisión requerida":result.orderStatus==="payment_failed"||result.orderStatus==="cancelled"?"Pago rechazado":result.orderStatus==="expired"?"La sesión de pago expiró":"Estamos confirmando tu pago";
  return <article className="legal-content"><p className="eyebrow">PAGO EN FLOW</p><h1>{heading}</h1>{error?<p>{error}</p>:!result?<p>Esto puede tomar unos segundos. No cierres esta ventana.</p>:<><p><strong>{result.orderNumber}</strong></p><p>Total: {money.format(result.total)}</p>{result.orderStatus==="paid"&&<p>Tu pago fue validado directamente con Flow y tu pedido quedó confirmado.</p>}{result.orderStatus==="payment_review"&&<p>Recibimos el pago, pero necesitamos revisar manualmente la disponibilidad. No volveremos a cobrarte.</p>}{!terminal.has(result.orderStatus)&&<p>Flow aún no confirma el resultado definitivo. Actualizaremos esta pantalla automáticamente.</p>}</>}<Link href="/">Volver a la tienda</Link></article>;
}
