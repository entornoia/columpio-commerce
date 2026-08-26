import type { SupabaseClient } from "@supabase/supabase-js";
import { runSellerAgent } from "../../agent/runner";
import { fetchInstagramImage } from "./image";
import { parseInstagramWebhookWithDiagnostics } from "./parser";
import { instagramConversations, instagramEvents, instagramIdempotency } from "./stores";
import type { IncomingCommerceMessage } from "./types";
import { instagramDevLog } from "./logging";

const HUMAN_MESSAGE = "Voy a derivar esta conversación para que la revise una persona del equipo. No puedo confirmar por este medio cobros, devoluciones ni situaciones sensibles.";

function maskedId(id: string) { return id.length > 6 ? `${id.slice(0, 3)}…${id.slice(-3)}` : "***"; }

function requiresHuman(text: string | null) {
  return Boolean(text && /\b(hablar con (?:una )?persona|humano|ejecutiv[oa]|reclamo|devol\w*|reembolso|cobr\w*|pago duplicado|fraude|demanda|legal)\b/i.test(text));
}

export function formatInstagramResponse(text: string, maxLength = 950) {
  let compact = text.replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (compact.length % 2 === 0 && compact.slice(0, compact.length / 2) === compact.slice(compact.length / 2)) compact = compact.slice(0, compact.length / 2).trim();
  if (compact.length <= maxLength) return compact;
  const cut = compact.slice(0, maxLength - 1);
  const boundary = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return `${cut.slice(0, boundary > maxLength * 0.6 ? boundary + 1 : maxLength - 1).trim()}…`;
}

export type InstagramProcessorDependencies = {
  supabase: SupabaseClient;
  sendText: (recipientId: string, text: string) => Promise<void>;
  fetchImage?: (url: string) => Promise<string>;
};

export async function processIncomingInstagramMessage(message: IncomingCommerceMessage, dependencies: InstagramProcessorDependencies) {
  const startedAt = Date.now();
  if (!instagramIdempotency.claim(message.eventId)) {
    instagramDevLog("event ignored", { reason: "duplicate", sender: maskedId(message.externalUserId) });
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "duplicate", receivedAt: message.receivedAt });
    return { status: "duplicate" as const };
  }
  instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "received", receivedAt: message.receivedAt });
  const conversation = instagramConversations.get(message.externalUserId);
  instagramDevLog("context recovered", { sender: maskedId(message.externalUserId), messageCount: conversation.messages.length, needsHuman: conversation.needsHuman });
  try {
    if (conversation.needsHuman || requiresHuman(message.text)) {
      conversation.needsHuman = true;
      instagramConversations.set(message.externalUserId, conversation);
      await dependencies.sendText(message.externalUserId, HUMAN_MESSAGE);
      instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "escalated", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt });
      return { status: "escalated" as const, message: HUMAN_MESSAGE };
    }
    const userText = message.text ?? "Recomiéndame algo que combine con la prenda de la imagen.";
    const messages = [...conversation.messages, { role: "user" as const, content: userText }];
    const image = message.imageUrl ? await (dependencies.fetchImage ?? fetchInstagramImage)(message.imageUrl) : undefined;
    instagramDevLog("agent started", { sender: maskedId(message.externalUserId), hasText: Boolean(message.text), hasImage: Boolean(image) });
    const result = await runSellerAgent(dependencies.supabase, { messages, image, garmentAnalysis: image ? undefined : conversation.garmentAnalysis });
    instagramDevLog("agent completed", { sender: maskedId(message.externalUserId), toolCalls: result.debug.toolCalls, searches: result.debug.searches.length });
    const responseText = formatInstagramResponse(result.message);
    await dependencies.sendText(message.externalUserId, responseText);
    instagramConversations.set(message.externalUserId, { messages: [...messages, { role: "assistant", content: responseText }], garmentAnalysis: result.garmentAnalysis, needsHuman: false });
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "processed", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, toolCalls: result.debug.toolCalls, resultCount: result.debug.searches.reduce((total, item) => total + item.resultCount, 0) });
    return { status: "processed" as const, message: responseText, debug: result.debug };
  } catch (error) {
    instagramIdempotency.release(message.eventId);
    const safeError = error instanceof Error ? error.message : "Error interno";
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "failed", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, error: safeError });
    instagramDevLog("processing failed", { eventId: message.eventId, sender: maskedId(message.externalUserId), durationMs: Date.now() - startedAt, error: safeError }, "error");
    throw error;
  }
}

export async function processInstagramPayload(payload: unknown, ownAccountId: string | undefined, dependencies: InstagramProcessorDependencies) {
  const parsed = parseInstagramWebhookWithDiagnostics(payload, ownAccountId);
  const messages = parsed.messages;
  instagramDevLog("events parsed", { accepted: messages.length, ignored: parsed.ignored.length });
  for (const event of parsed.ignored) instagramDevLog("event ignored", event);
  const results = [];
  for (const message of messages) results.push(await processIncomingInstagramMessage(message, dependencies));
  return { accepted: messages.length, results };
}
