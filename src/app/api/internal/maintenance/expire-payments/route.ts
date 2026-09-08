import {assertCronAuthorization} from "@/lib/internal/cron-auth";
import {createServiceClient} from "@/lib/supabase/service";
export const runtime="nodejs";
export async function GET(request:Request){try{assertCronAuthorization(request);const db=createServiceClient();let expired=0,batches=0;while(batches<5){const{data,error}=await db.rpc("expire_web_pending_payments",{p_limit:100});if(error)throw error;const count=Number(data??0);expired+=count;batches++;if(count<100)break;}return Response.json({expired,batches});}catch(error){const unauthorized=error instanceof Error&&error.message==="No autorizado.";return Response.json({error:unauthorized?"No autorizado.":"No se pudo ejecutar mantenimiento."},{status:unauthorized?401:500});}}
