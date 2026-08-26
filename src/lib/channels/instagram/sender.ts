import { requireInstagramSendConfig } from "./config";
import { instagramDevLog } from "./logging";

type MetaError = { error?: { message?: string; type?: string; code?: number; error_subcode?: number } };

export async function sendInstagramText(recipientId: string, text: string) {
  const config = requireInstagramSendConfig();
  const maskedRecipient = recipientId.length > 6 ? `${recipientId.slice(0, 3)}…${recipientId.slice(-3)}` : "***";
  instagramDevLog("send started", { recipient: maskedRecipient });
  const response = await fetch(`https://graph.instagram.com/${config.graphVersion}/${encodeURIComponent(config.accountId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as MetaError;
    const code = body.error?.code;
    instagramDevLog("send failed", { status: response.status, code, type: body.error?.type, message: body.error?.message?.slice(0, 240) }, "error");
    throw new Error(response.status === 429 || code === 4 || code === 613 ? "Meta aplicó un límite de frecuencia temporal." : `Meta rechazó el envío (${response.status}${code ? `, código ${code}` : ""}).`);
  }
  instagramDevLog("send status", { status: response.status, recipient: maskedRecipient });
}
