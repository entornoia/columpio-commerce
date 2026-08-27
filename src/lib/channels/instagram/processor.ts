import type { SupabaseClient } from "@supabase/supabase-js";
import { runSellerAgent, type SellerAgentResult } from "../../agent/runner";
import { createInstagramConversationControl, type InstagramConversationControl } from "./conversation-repository";
import { runWithConversationHandoff } from "./handoff";
import { fetchInstagramImage } from "./image";
import { instagramDevLog } from "./logging";
import { parseInstagramWebhookWithDiagnostics } from "./parser";
import { refreshInstagramProfile } from "./profile";
import { instagramConversations, instagramEvents, instagramIdempotency } from "./stores";
import type { IncomingCommerceMessage, InstagramConversation } from "./types";

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
  conversationControl?: InstagramConversationControl;
  runAgent?: typeof runSellerAgent;
  refreshProfile?: (externalUserId: string) => Promise<void>;
};

type GeneratedResponse = {
  responseText: string;
  status: "processed" | "escalated";
  conversation: InstagramConversation;
  result?: SellerAgentResult;
};

export async function processIncomingInstagramMessage(message: IncomingCommerceMessage, dependencies: InstagramProcessorDependencies) {
  const startedAt = Date.now();
  if (!instagramIdempotency.claim(message.eventId)) {
    instagramDevLog("event ignored", { reason: "duplicate", sender: maskedId(message.externalUserId) });
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "duplicate", receivedAt: message.receivedAt });
    return { status: "duplicate" as const };
  }
  instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "received", receivedAt: message.receivedAt });
  try {
    const control = dependencies.conversationControl ?? createInstagramConversationControl(dependencies.supabase);
    const outcome = await runWithConversationHandoff({
      control,
      message: { channel: message.channel, externalUserId: message.externalUserId, eventId: message.eventId, receivedAt: message.receivedAt },
      background: async () => {
        if (dependencies.refreshProfile) return dependencies.refreshProfile(message.externalUserId);
        await refreshInstagramProfile(dependencies.supabase, message.externalUserId);
      },
      generate: async (): Promise<GeneratedResponse> => {
        const conversation = instagramConversations.get(message.externalUserId);
        instagramDevLog("context recovered", { sender: maskedId(message.externalUserId), messageCount: conversation.messages.length, needsHuman: conversation.needsHuman });
        if (conversation.needsHuman || requiresHuman(message.text)) {
          return { responseText: HUMAN_MESSAGE, status: "escalated", conversation: { ...conversation, needsHuman: true } };
        }

        const userText = message.text ?? "Recomiéndame algo que combine con la prenda de la imagen.";
        const messages = [...conversation.messages, { role: "user" as const, content: userText }];
        const image = message.imageUrl ? await (dependencies.fetchImage ?? fetchInstagramImage)(message.imageUrl) : undefined;
        instagramDevLog("agent started", { sender: maskedId(message.externalUserId), hasText: Boolean(message.text), hasImage: Boolean(image) });
        const result = await (dependencies.runAgent ?? runSellerAgent)(dependencies.supabase, { messages, image, garmentAnalysis: image ? undefined : conversation.garmentAnalysis });
        instagramDevLog("agent completed", { sender: maskedId(message.externalUserId), toolCalls: result.debug.toolCalls, searches: result.debug.searches.length });
        const responseText = formatInstagramResponse(result.message);
        return { responseText, status: "processed", result, conversation: { messages: [...messages, { role: "assistant", content: responseText }], garmentAnalysis: result.garmentAnalysis, needsHuman: false } };
      },
      send: async (generated) => dependencies.sendText(message.externalUserId, generated.responseText),
    });

    if (outcome.status === "paused") {
      instagramDevLog("event ignored", { reason: outcome.reason, sender: maskedId(message.externalUserId) });
      const status = outcome.reason === "human_only" ? "human_only" as const : "paused" as const;
      instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status, receivedAt: message.receivedAt, durationMs: Date.now() - startedAt });
      return { status, reason: outcome.reason };
    }
    if (outcome.status === "handoff_error") {
      instagramDevLog("handoff check failed", { sender: maskedId(message.externalUserId), error: outcome.error }, "error");
      instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: "handoff_error", receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, error: outcome.error });
      return { status: "handoff_error" as const };
    }

    const generated = outcome.value;
    instagramConversations.set(message.externalUserId, generated.conversation);
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: generated.status, receivedAt: message.receivedAt, durationMs: Date.now() - startedAt, toolCalls: generated.result?.debug.toolCalls, resultCount: generated.result?.debug.searches.reduce((total, item) => total + item.resultCount, 0) });
    return { status: generated.status, message: generated.responseText, ...(generated.result ? { debug: generated.result.debug } : {}) };
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
