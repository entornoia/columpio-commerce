import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getInstagramConfig, requireInstagramWebhookConfig } from "@/lib/channels/instagram/config";
import { processInstagramPayload } from "@/lib/channels/instagram/processor";
import { sendInstagramText } from "@/lib/channels/instagram/sender";
import { inspectMetaSignature, verifyWebhookToken } from "@/lib/channels/instagram/security";
import { instagramDevLog } from "@/lib/channels/instagram/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  let config;
  try { config = requireInstagramWebhookConfig(); } catch { return new Response("Canal no configurado.", { status: 503 }); }
  const url = new URL(request.url);
  const valid = url.searchParams.get("hub.mode") === "subscribe" && verifyWebhookToken(url.searchParams.get("hub.verify_token"), config.verifyToken);
  if (!valid) return new Response("Forbidden", { status: 403 });
  return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  let config;
  try { config = requireInstagramWebhookConfig(); } catch { return Response.json({ error: "Canal no configurado." }, { status: 503 }); }
  const rawBody = Buffer.from(await request.arrayBuffer());
  const signature = inspectMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret);
  instagramDevLog("signature", signature.diagnostics);
  if (!signature.match) return Response.json({ error: "Firma inválida." }, { status: 401 });
  instagramDevLog("webhook accepted", { rawBodyBytes: rawBody.length });
  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { return Response.json({ error: "JSON inválido." }, { status: 400 }); }
  const ownAccountId = getInstagramConfig().accountId;
  after(async () => {
    try { await processInstagramPayload(payload, ownAccountId, { supabase: createAdminClient(), sendText: sendInstagramText }); }
    catch (error) { instagramDevLog("webhook async failed", { error: error instanceof Error ? error.message : "Error interno" }, "error"); }
  });
  return Response.json({ received: true });
}
