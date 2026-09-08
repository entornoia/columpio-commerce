"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props={orderId:string;orderStatus:string;paymentStatus:string;stockException:boolean;deliveryType:"pickup"|"shipping";fulfillmentStatus:string};

export function FulfillmentActions(props:Props){
  const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [note,setNote]=useState("");
  const next=props.fulfillmentStatus==="unfulfilled"?"preparing":props.fulfillmentStatus==="preparing"?(props.deliveryType==="pickup"?"ready_for_pickup":"shipped"):props.fulfillmentStatus==="shipped"&&props.deliveryType==="shipping"?"delivered":null;
  const labels:Record<string,string>={preparing:"Marcar en preparación",ready_for_pickup:"Marcar listo para retiro",shipped:"Marcar despachado",delivered:"Marcar entregado"};
  const operational=props.orderStatus==="paid"&&props.paymentStatus==="paid"&&!props.stockException;
  async function transition(){if(!next||busy)return;setBusy(true);setError("");try{const response=await fetch(`/api/admin/orders/${props.orderId}/fulfillment`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({expectedStatus:props.fulfillmentStatus,toStatus:next,note:note.trim()||null})});const body=await response.json();if(!response.ok)throw new Error(body.error||"No se pudo actualizar el pedido.");router.refresh();}catch(reason){setError(reason instanceof Error?reason.message:"No se pudo actualizar el pedido.");}finally{setBusy(false);}}
  return <section className="order-action-card"><span className="eyebrow">FULFILLMENT</span><h2>Gestionar entrega</h2>{!operational?<p className="order-warning">Solo un pedido pagado y sin excepción de stock puede avanzar.</p>:!next?<p>Este flujo no tiene otra transición disponible.</p>:<><label>Nota interna opcional<textarea maxLength={500} value={note} onChange={(event)=>setNote(event.target.value)} placeholder="Contexto para el equipo"/></label><button className="primary-button" disabled={busy} onClick={()=>void transition()}>{busy?"Actualizando…":labels[next]}</button></>}{error&&<p className="error-state">{error}</p>}</section>;
}
