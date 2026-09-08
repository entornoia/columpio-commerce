import "server-only";
import {createResendProvider,EmailProviderError,type EmailProvider} from "./resend";
import {createServiceClient} from "@/lib/supabase/service";

type Db=ReturnType<typeof createServiceClient>;
type Dependencies={db?:Db;provider?:EmailProvider;logger?:Pick<Console,"info"|"error">};
const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!));
const money=(value:unknown)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(Number(value??0));
type Row=Record<string,unknown>;
const one=(value:unknown):Row=>Array.isArray(value)?value[0] as Row:value as Row;

export async function buildPaidOrderEmail(db:Db,orderId:string){
  const{data,error}=await db.from("web_orders").select("order_number,total,status,web_order_customers(email,first_name),web_order_addresses(delivery_type,recipient_name,street,street_number,commune,region_name),web_order_items(product_name,color,size,quantity,final_unit_price,line_subtotal)").eq("id",orderId).single();
  if(error||!data||data.status!=="paid")throw new Error("Pedido pagado no disponible para email.");
  const customer=one(data.web_order_customers),address=one(data.web_order_addresses),items=(data.web_order_items??[]) as Row[];
  const itemText=items.map((item:Row)=>`${item.quantity} × ${item.product_name} (${item.color}, talla ${item.size}) — ${money(item.line_subtotal)}`).join("\n");
  const delivery=address?.delivery_type==="shipping"?`Despacho a ${address.street} ${address.street_number}, ${address.commune}, ${address.region_name}.`:"Retiro disponible. Te avisaremos cuando tu pedido esté listo.";
  const text=`Hola ${customer.first_name},\n\nTu pago fue confirmado.\nPedido ${data.order_number}\n${itemText}\nTotal: ${money(data.total)}\n${delivery}\n\nGracias por comprar en Columpio Store.`;
  const rows=items.map((item:Row)=>`<li>${escape(item.quantity)} × <strong>${escape(item.product_name)}</strong> · ${escape(item.color)}, talla ${escape(item.size)} — ${escape(money(item.line_subtotal))}</li>`).join("");
  const html=`<div style="font-family:Arial,sans-serif;color:#302a26;line-height:1.6"><h1 style="font-family:Georgia,serif">Pago confirmado</h1><p>Hola ${escape(customer.first_name)},</p><p>Recibimos correctamente el pago de tu pedido <strong>${escape(data.order_number)}</strong>.</p><ul>${rows}</ul><p><strong>Total: ${escape(money(data.total))}</strong></p><p>${escape(delivery)}</p><p>Gracias por comprar en Columpio Store.</p></div>`;
  return{to:String(customer.email),orderNumber:String(data.order_number),subject:`Confirmación de pedido ${data.order_number} · Columpio Store`,html,text};
}

export async function dispatchPaidOrderEmails(limit=25,deps:Dependencies={}){
  const db=deps.db??createServiceClient() as unknown as Db,provider=deps.provider??createResendProvider(),logger=deps.logger??console;
  const claim=await db.rpc("claim_web_order_email_events",{p_limit:limit});if(claim.error)throw new Error("No se pudo reclamar el outbox de emails.");
  let sent=0,failed=0;
  for(const event of claim.data??[]){
    try{const content=await buildPaidOrderEmail(db,event.order_id);const delivered=await provider.send({...content,idempotencyKey:`order-paid/${event.event_id}`});const done=await db.rpc("complete_web_order_email_event",{p_event_id:event.event_id,p_provider_message_id:delivered.id});if(done.error||done.data!==true)throw new Error("No se pudo completar el evento de email.");sent++;logger.info("[order-email] sent",{eventId:event.event_id,orderNumber:content.orderNumber});}
    catch(cause){const code=cause instanceof EmailProviderError?cause.code:"internal_error";const message=cause instanceof Error?cause.message:"No se pudo enviar el correo.";await db.rpc("fail_web_order_email_event",{p_event_id:event.event_id,p_error_code:code,p_error_message:message});failed++;logger.error("[order-email] failed",{eventId:event.event_id,code});}
  }
  return{claimed:claim.data?.length??0,sent,failed};
}
