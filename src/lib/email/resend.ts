export type TransactionalEmail={to:string;subject:string;html:string;text:string;idempotencyKey:string};
export type EmailProvider={send(message:TransactionalEmail):Promise<{id:string}>};

function clean(value:unknown,fallback:string){if(typeof value!=="string")return fallback;return value.replace(/<[^>]*>/g," ").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,240)||fallback;}

export class EmailProviderError extends Error{readonly code:string;constructor(message:string,code:string){super(message);this.code=code;this.name="EmailProviderError";}}

export function createResendProvider(fetcher:typeof fetch=fetch):EmailProvider{
  const apiKey=process.env.RESEND_API_KEY;const from=process.env.ORDER_EMAIL_FROM;
  if(!apiKey||!from)throw new EmailProviderError("Proveedor de email no configurado.","provider_not_configured");
  return{async send(message){
    const response=await fetcher("https://api.resend.com/emails",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json","idempotency-key":message.idempotencyKey},body:JSON.stringify({from,to:[message.to],subject:message.subject,html:message.html,text:message.text})});
    const body=await response.json().catch(()=>null) as {id?:unknown;name?:unknown;message?:unknown}|null;
    if(!response.ok)throw new EmailProviderError(clean(body?.message,"El proveedor rechazó el envío."),clean(body?.name,`http_${response.status}`));
    if(typeof body?.id!=="string"||!body.id)throw new EmailProviderError("El proveedor no confirmó el mensaje.","invalid_provider_response");
    return{id:body.id};
  }};
}
