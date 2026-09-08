import {dispatchPaidOrderEmails} from "@/lib/email/order-confirmation";
import {assertCronAuthorization} from "@/lib/internal/cron-auth";
export const runtime="nodejs";
export async function GET(request:Request){try{assertCronAuthorization(request);return Response.json(await dispatchPaidOrderEmails(25));}catch(error){const unauthorized=error instanceof Error&&error.message==="No autorizado.";return Response.json({error:unauthorized?"No autorizado.":"No se pudo ejecutar el despacho de emails."},{status:unauthorized?401:500});}}
