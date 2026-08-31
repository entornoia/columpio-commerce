import "server-only";
import { createHash } from "node:crypto";
import { createFlowGateway, flowCallbackUrls, FlowRequestError, assertFlowPaymentUrl, type FlowGateway, type FlowPaymentStatus } from "@/lib/payments/flow";
import { createServiceClient } from "@/lib/supabase/service";
import { hashCartToken } from "./cart-server";
import type { WebPaymentResult } from "./payment-contract";

type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{data: unknown;error: {message:string}|null}> };
type Dependencies = { db?: RpcClient; gateway?: FlowGateway };
const attempts = new Map<string, {count:number;resetAt:number}>();
function rateLimit(token:string){const key=createHash("sha256").update(token).digest("hex"),now=Date.now(),current=attempts.get(key);if(!current||current.resetAt<=now){attempts.set(key,{count:1,resetAt:now+10*60_000});return;}if(current.count>=5)throw new Error("Demasiados intentos de pago. Intenta nuevamente en unos minutos.");current.count+=1;}
function row(value:unknown){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Respuesta de pago inválida.");return value as Record<string,unknown>;}
function safeError(error:unknown){return error instanceof FlowRequestError?error:{code:"internal_error",uncertain:true,message:"No se pudo confirmar la creación del pago."};}
function canonicalStatus(status:FlowPaymentStatus){return JSON.stringify({flowOrder:status.flowOrder,commerceOrder:status.commerceOrder,status:status.status,currency:status.currency,amount:status.amount});}

export async function createWebFlowPayment(token:string|undefined,input:{orderId:string;idempotencyKey:string},dependencies:Dependencies={}){
  if(!token)throw new Error("No encontramos la sesión de tu pedido."); rateLimit(token);
  const db=dependencies.db??createServiceClient(),gateway=dependencies.gateway??createFlowGateway();
  const claimResult=await db.rpc("claim_web_flow_payment",{p_token_hash:hashCartToken(token),p_order_id:input.orderId,p_idempotency_key:input.idempotencyKey});
  if(claimResult.error)throw new Error(/reservation expired/i.test(claimResult.error.message)?"La reserva venció antes de iniciar el pago.":"No pudimos preparar el pago.");
  const claim=row(claimResult.data);
  if(typeof claim.paymentUrl==="string"&&claim.paymentUrl){assertFlowPaymentUrl(claim.paymentUrl);return{paymentUrl:claim.paymentUrl,status:String(claim.attemptStatus)};}
  if(!claim.claimOwned)return{paymentUrl:null,status:String(claim.attemptStatus)};
  const attemptId=String(claim.attemptId),claimToken=String(claim.claimToken),commerceOrder=String(claim.commerceOrder);
  try{
    const existing=await gateway.findByCommerceOrder(commerceOrder);
    if(existing){await db.rpc("fail_web_flow_payment_attempt",{p_attempt_id:attemptId,p_claim_token:claimToken,p_error_code:"existing_flow_payment",p_error_message:"Flow payment exists without a recoverable token",p_uncertain:true});return{paymentUrl:null,status:"uncertain"};}
    const checkout=await gateway.createPayment({commerceOrder,subject:`Pedido ${String(claim.orderNumber)}`,currency:"CLP",amount:Number(claim.amount),email:String(claim.email),paymentMethod:9,...flowCallbackUrls(),optional:JSON.stringify({orderId:claim.orderId,orderNumber:claim.orderNumber,channel:"web"})});
    assertFlowPaymentUrl(checkout.paymentUrl);
    const completed=await db.rpc("complete_web_flow_payment_attempt",{p_attempt_id:attemptId,p_claim_token:claimToken,p_provider_order_id:checkout.flowOrder,p_flow_token:checkout.token,p_payment_url:checkout.paymentUrl});
    if(completed.error)throw new FlowRequestError("No se pudo persistir el pago Flow.","persistence_error",true);
    return{paymentUrl:checkout.paymentUrl,status:"ready"};
  }catch(cause){const failure=safeError(cause);await db.rpc("fail_web_flow_payment_attempt",{p_attempt_id:attemptId,p_claim_token:claimToken,p_error_code:failure.code,p_error_message:failure.message,p_uncertain:failure.uncertain});if(failure.uncertain)return{paymentUrl:null,status:"uncertain"};throw cause;}
}

export async function confirmWebFlowToken(token:string,dependencies:Dependencies={}){
  if(!/^[A-Za-z0-9_-]+$/.test(token))throw new Error("Token Flow inválido.");
  const db=dependencies.db??createServiceClient(),gateway=dependencies.gateway??createFlowGateway();
  const contextResult=await db.rpc("get_web_flow_callback_context",{p_flow_token:token});
  if(contextResult.error)throw new Error("No pudimos identificar el pago.");
  if(!contextResult.data)return{handled:false};
  const context=row(contextResult.data),status=await gateway.getStatus(token);
  if(status.commerceOrder!==context.commerceOrder||status.flowOrder!==Number(context.providerOrderId??status.flowOrder)||status.amount!==Number(context.amount)||status.currency!==context.currency)throw new Error("Flow payment verification mismatch");
  const payloadHash=createHash("sha256").update(canonicalStatus(status)).digest("hex");
  const processed=await db.rpc("process_web_flow_event",{p_flow_token:token,p_provider_order_id:status.flowOrder,p_commerce_order:status.commerceOrder,p_provider_status:status.status,p_currency:status.currency,p_amount:status.amount,p_payload_hash:payloadHash});
  if(processed.error)throw new Error("No pudimos procesar la confirmación del pago.");
  return{handled:true,result:processed.data};
}

export async function getWebPaymentResult(token:string|undefined,dependencies:Dependencies={}):Promise<WebPaymentResult|null>{
  if(!token)return null;const db=dependencies.db??createServiceClient();const result=await db.rpc("get_web_payment_result",{p_token_hash:hashCartToken(token)});if(result.error)throw new Error("No pudimos consultar el pago.");if(!result.data)return null;const value=row(result.data);return{orderNumber:String(value.orderNumber),orderStatus:String(value.orderStatus),paymentStatus:String(value.paymentStatus),total:Number(value.total),currency:"CLP",stockException:Boolean(value.stockException)};
}
