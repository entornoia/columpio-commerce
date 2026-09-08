import "server-only";
import { timingSafeEqual } from "node:crypto";

export function assertCronAuthorization(request:Request,secret=process.env.CRON_SECRET){
  if(!secret||secret.length<32)throw new Error("CRON_SECRET no está configurado de forma segura.");
  const provided=request.headers.get("authorization");const expected=`Bearer ${secret}`;
  if(!provided||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))throw new Error("No autorizado.");
}
