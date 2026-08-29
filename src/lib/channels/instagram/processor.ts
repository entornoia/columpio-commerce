import type { SupabaseClient } from "@supabase/supabase-js";
import { runSellerAgent, type SellerAgentResult } from "../../agent/runner";
import { createInstagramConversationControl, type InstagramConversationControl } from "./conversation-repository";
import { getInstagramAutomationBlockReason, isInstagramAgentGloballyEnabled, runWithConversationHandoff } from "./handoff";
import { fetchInstagramImage } from "./image";
import { instagramDevLog, instagramOperationalLog } from "./logging";
import { parseInstagramWebhookWithDiagnostics } from "./parser";
import { refreshInstagramProfile } from "./profile";
import { instagramConversations, instagramEvents, instagramIdempotency } from "./stores";
import type { IncomingCommerceMessage, InstagramConversation } from "./types";
import { routeInstagramIntent, type AmbiguousIntentClassifier } from "./intent-router.ts";
import { generalInfoResponse } from "./general-info.ts";
import { EXCHANGE_CLARIFICATION_RESPONSE, GREETING_RESPONSE, safeIntentResponse } from "./intent-responses.ts";
import { AMBIGUOUS_EXCHANGE_REASON, classifyIntentByRules, COMMERCIAL_CONTINUATION_REASON, GREETING_REASON, intentRuleFeatures } from "./intent-rules.ts";
import { handoffAcknowledgement } from "./handoff-response";
import { sendHandoffNotification } from "./handoff-notification";
import { updateHandoffNotification, type HandoffReason } from "./handoff-cases";

function maskedId(id: string) { return id.length > 6 ? `${id.slice(0, 3)}…${id.slice(-3)}` : "***"; }

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
  globalAgentEnabled?: () => boolean;
  classifyIntent?: AmbiguousIntentClassifier;
};

type GeneratedResponse = {
  responseText: string | null;
  status: "processed" | "escalated" | "ignored";
  conversation: InstagramConversation;
  result?: SellerAgentResult;
  pauseAfterSend?: boolean;
  intent?: import("./conversation-repository").InstagramIntent;
  classifiedAt?: string;
  handoffReason?: HandoffReason;
};

function withinHours(value: string | null, reference: string, hours: number) {
  if (!value) return false;
  const elapsed = Date.parse(reference) - Date.parse(value);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= hours * 60 * 60_000;
}

function handoffReasonFor(intent: import("./conversation-repository").InstagramIntent, secondUnknown: boolean): HandoffReason | null {
  if (intent === "exchange_return" || intent === "after_sales" || intent === "business_proposal" || intent === "human_request") return intent;
  return secondUnknown ? "unknown_escalation" : null;
}

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
      globalEnabled: dependencies.globalAgentEnabled,
      generate: async (): Promise<GeneratedResponse> => {
        const conversation = instagramConversations.get(message.externalUserId);
        instagramDevLog("context recovered", { sender: maskedId(message.externalUserId), messageCount: conversation.messages.length, needsHuman: conversation.needsHuman });
        const automationState = await control.getAutomationState(message.channel, message.externalUserId);
        const previousIntent = await control.getIntentState(message.channel, message.externalUserId);
        instagramOperationalLog("intent pre-state", { agentEnabled: automationState.agentEnabled, humanOnly: automationState.humanOnly, lastIntent: previousIntent.lastIntent });
        const features = intentRuleFeatures(message.text);
        const deterministicRule = classifyIntentByRules(message, previousIntent);
        instagramOperationalLog("normalizedTextFeatures", features);
        instagramOperationalLog("intent rule evaluated", { rule: "exchange_return", matched: deterministicRule?.intent === "exchange_return" });
        const classification = await routeInstagramIntent(message, previousIntent, dependencies.classifyIntent);
        const ambiguousExchange = classification.intent === "unknown" && classification.reason === AMBIGUOUS_EXCHANGE_REASON;
        const isolatedContinuation = classification.intent === "unknown" && classification.reason === COMMERCIAL_CONTINUATION_REASON;
        const secondUnknown = classification.intent === "unknown" && !ambiguousExchange && !isolatedContinuation && previousIntent.lastIntent === "unknown" && withinHours(previousIntent.lastIntentAt, message.receivedAt, 24);
        const handoffReason = handoffReasonFor(classification.intent, secondUnknown);
        const pauseAfterSend = handoffReason !== null;
        if (!pauseAfterSend) await control.recordIntent(message.channel, message.externalUserId, classification.intent, message.receivedAt);
        instagramDevLog("intent classified", { sender: maskedId(message.externalUserId), intent: classification.intent, confidence: classification.confidence, source: classification.source, reason: classification.reason });
        instagramOperationalLog("intent classified", { intent: classification.intent, source: classification.source, confidence: classification.confidence });

        if (classification.intent === "social_reaction") return { responseText: null, status: "ignored", conversation, intent: classification.intent, classifiedAt: message.receivedAt };
        if (classification.intent === "general_info") return { responseText: classification.reason === GREETING_REASON ? GREETING_RESPONSE : generalInfoResponse(message.text), status: "processed", conversation, intent: classification.intent, classifiedAt: message.receivedAt };
        if (classification.intent !== "sales") {
          if (classification.intent === "exchange_return") instagramOperationalLog("temporary_human requested", { requested: true, sellerAgentInvoked: false });
          const responseText = ambiguousExchange
            ? EXCHANGE_CLARIFICATION_RESPONSE
            : handoffReason
              ? handoffAcknowledgement(handoffReason)
              : safeIntentResponse(classification.intent, false);
          return { responseText, status: pauseAfterSend ? "escalated" : "processed", pauseAfterSend, conversation, intent: classification.intent, classifiedAt: message.receivedAt, handoffReason: handoffReason ?? undefined };
        }

        const userText = message.text ?? "Recomiéndame algo que combine con la prenda de la imagen.";
        const messages = [...conversation.messages, { role: "user" as const, content: userText }];
        const image = message.imageUrl ? await (dependencies.fetchImage ?? fetchInstagramImage)(message.imageUrl) : undefined;
        instagramOperationalLog("seller agent invocation", { invoked: true, intent: classification.intent });
        instagramDevLog("agent started", { sender: maskedId(message.externalUserId), hasText: Boolean(message.text), hasImage: Boolean(image) });
        const result = await (dependencies.runAgent ?? runSellerAgent)(dependencies.supabase, { messages, image, garmentAnalysis: image ? undefined : conversation.garmentAnalysis }, {
          externalUserId: message.externalUserId,
          eventId: message.eventId,
          authorizeMutation: async () => {
            const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, dependencies.globalAgentEnabled ?? isInstagramAgentGloballyEnabled);
            if (reason) throw new Error(`Operación comercial bloqueada: ${reason}`);
          },
        });
        instagramDevLog("agent completed", { sender: maskedId(message.externalUserId), toolCalls: result.debug.toolCalls, searches: result.debug.searches.length });
        const responseText = formatInstagramResponse(result.message);
        return { responseText, status: "processed", result, conversation: { messages: [...messages, { role: "assistant", content: responseText }], garmentAnalysis: result.garmentAnalysis, needsHuman: false } };
      },
      pauseBeforeSend: (generated) => generated.pauseAfterSend === true,
      persistPause: async (generated) => {
        if (!generated.handoffReason || !generated.classifiedAt) throw new Error("Faltan metadatos para persistir el handoff");
        const transition = await control.transitionToTemporaryHuman(message.channel, message.externalUserId, message.eventId, generated.handoffReason, generated.classifiedAt);
        if (transition.transitioned && transition.caseId) {
          try {
            const { data } = await dependencies.supabase.from("instagram_conversations").select("instagram_username")
              .eq("channel", "instagram").eq("external_user_id", message.externalUserId).single();
            const notification = await sendHandoffNotification({
              caseId: transition.caseId,
              reason: generated.handoffReason,
              instagramUsername: typeof data?.instagram_username === "string" ? data.instagram_username : null,
              maskedInstagramId: maskedId(message.externalUserId),
              createdAt: generated.classifiedAt,
            });
            await updateHandoffNotification(dependencies.supabase, transition.caseId, notification);
          } catch {
            instagramOperationalLog("handoff notification", { status: "failed", handoffPreserved: true }, "error");
          }
        }
        return transition.transitioned;
      },
      send: async (generated) => { if (generated.responseText) await dependencies.sendText(message.externalUserId, generated.responseText); },
    });

    if (outcome.status === "paused") {
      instagramOperationalLog("paused event ignored", { reason: outcome.reason, automaticResponse: false });
      instagramDevLog("event ignored", { reason: outcome.reason, sender: maskedId(message.externalUserId) });
      const status = outcome.reason === "global_disabled" ? "global_disabled" as const : outcome.reason === "human_only" ? "human_only" as const : "paused" as const;
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
    return { status: generated.status, ...(generated.responseText ? { message: generated.responseText } : {}), ...(generated.result ? { debug: generated.result.debug } : {}) };
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
