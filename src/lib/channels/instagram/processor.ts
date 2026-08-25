import type { SupabaseClient } from "@supabase/supabase-js";
import { runSellerAgent } from "../../agent/runner";
import { fetchInstagramImage } from "./image";
import { parseInstagramWebhook } from "./parser";
import { instagramConversations, instagramEvents, instagramIdempotency } from "./stores";
import type { IncomingCommerceMessage } from "./types";

const HUMAN_MESSAGE = "Voy a derivar esta conversación para que la revise una persona del equipo. No puedo confirmar por este medio cobros, devoluciones ni situaciones sensibles.";

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
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "duplicate", receivedAt: message.receivedAt });
    return { status: "duplicate" as const };
  }
  instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "received", receivedAt: message.receivedAt });
  const conversation = instagramConversations.get(message.externalUserId);
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
    const result = await runSellerAgent(dependencies.supabase, { messages, image, garmentAnalysis: image ? undefined : conversation.garmentAnalysis });
    const responseText = formatInstagramResponse(result.message);
    await dependencies.sendText(message.externalUserId, responseText);
    instagramConversations.set(message.externalUserId, { messages: [...messages, { role: "assistant", content: responseText }], garmentAnalysis: result.garmentAnalysis, needsHuman: false });
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "processed", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, toolCalls: result.debug.toolCalls, resultCount: result.debug.searches.reduce((total, item) => total + item.resultCount, 0) });
    return { status: "processed" as const, message: responseText, debug: result.debug };
  } catch (error) {
    instagramIdempotency.release(message.eventId);
    const safeError = error instanceof Error ? error.message : "Error interno";
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "failed", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, error: safeError });
    console.error("[instagram] processing_failed", { eventId: message.eventId, externalUserId: message.externalUserId, durationMs: Date.now() - startedAt, error: safeError });
    throw error;
  }
}

export async function processInstagramPayload(payload: unknown, ownAccountId: string | undefined, dependencies: InstagramProcessorDependencies) {
  const messages = parseInstagramWebhook(payload, ownAccountId);
  const results = [];
  for (const message of messages) results.push(await processIncomingInstagramMessage(message, dependencies));
  return { accepted: messages.length, results };
}
