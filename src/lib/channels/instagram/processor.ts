import type { SupabaseClient } from "@supabase/supabase-js";
import { createInstagramConversationControl, type InstagramConversationControl } from "./conversation-repository";
import { runWithConversationHandoff } from "./handoff";
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
import { stateForIntent } from "./conversation-state.ts";
import { instagramAdvisorModeEnabled, type SemanticInterpreter } from "./semantic-interpreter.ts";
import { runInstagramAdvisor } from "./advisor-orchestrator.ts";

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
  /** Compatibilidad del endpoint de prueba visual; advisor no descarga imágenes automáticamente. */
  fetchImage?: (url: string) => Promise<string>;
  conversationControl?: InstagramConversationControl;
  refreshProfile?: (externalUserId: string) => Promise<void>;
  globalAgentEnabled?: () => boolean;
  classifyIntent?: AmbiguousIntentClassifier;
  interpretCommerce?: SemanticInterpreter;
};

type GeneratedResponse = {
  responseText: string | null;
  status: "processed" | "escalated" | "ignored";
  conversation: InstagramConversation;
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
  if (intent === "exchange_return" || intent === "after_sales" || intent === "order_tracking" || intent === "business_proposal" || intent === "human_request") return intent;
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
        const commercialContext = await control.getConversationContext(message.channel, message.externalUserId);
        instagramOperationalLog("intent pre-state", { agentEnabled: automationState.agentEnabled, humanOnly: automationState.humanOnly, lastIntent: previousIntent.lastIntent, conversationState: commercialContext.state });
        const features = intentRuleFeatures(message.text);
        const deterministicRule = classifyIntentByRules(message, previousIntent);
        instagramOperationalLog("normalizedTextFeatures", features);
        instagramOperationalLog("intent rule evaluated", { rule: "exchange_return", matched: deterministicRule?.intent === "exchange_return" });
        const sensitiveIntent = deterministicRule && ["human_request", "exchange_return", "after_sales", "order_tracking", "business_proposal"].includes(deterministicRule.intent)
          ? deterministicRule : null;
        const classification = sensitiveIntent ?? await routeInstagramIntent(message, previousIntent, dependencies.classifyIntent);
        const ambiguousExchange = classification.intent === "unknown" && classification.reason === AMBIGUOUS_EXCHANGE_REASON;
        const isolatedContinuation = classification.intent === "unknown" && classification.reason === COMMERCIAL_CONTINUATION_REASON;
        const secondUnknown = commercialContext.state !== "sales" && classification.intent === "unknown" && !ambiguousExchange && !isolatedContinuation && previousIntent.lastIntent === "unknown" && withinHours(previousIntent.lastIntentAt, message.receivedAt, 24);
        const handoffReason = handoffReasonFor(classification.intent, secondUnknown);
        const pauseAfterSend = handoffReason !== null;
        if (!pauseAfterSend) await control.recordIntent(message.channel, message.externalUserId, classification.intent, message.receivedAt);
        instagramDevLog("intent classified", { sender: maskedId(message.externalUserId), intent: classification.intent, confidence: classification.confidence, source: classification.source, reason: classification.reason });
        instagramOperationalLog("intent classified", { intent: classification.intent, source: classification.source, confidence: classification.confidence });

        const nextState = stateForIntent(classification.intent);
        if (!pauseAfterSend && nextState && nextState !== "human") {
          await control.updateConversationContext(message.channel, message.externalUserId, {
            state: nextState, changedAt: message.receivedAt, touchCommercialContext: nextState === "sales",
          });
        }

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

        if (instagramAdvisorModeEnabled()) {
          const advised = await runInstagramAdvisor({
            supabase: dependencies.supabase,
            externalUserId: message.externalUserId,
            receivedAt: message.receivedAt,
            messageText: message.text ?? "Muéstrame productos disponibles.",
            conversationState: commercialContext.state,
            interpret: dependencies.interpretCommerce,
          });
          if (advised.handoffIntent) {
            const reason = advised.handoffIntent;
            return {
              responseText: handoffAcknowledgement(reason), status: "escalated", pauseAfterSend: true,
              conversation, intent: reason, classifiedAt: message.receivedAt, handoffReason: reason,
            };
          }
          instagramOperationalLog("instagram advisor", { action: advised.action, transactionalAccess: false });
          return { responseText: advised.responseText, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }

        return {
          responseText: "La asesoría automática de productos no está disponible en este momento.",
          status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt,
        };

        /* Flujo transaccional 3A.4/3A.5 conservado fuera de la ruta activa de Instagram.
        if (semanticCommerceOrchestratorEnabled()) {
          const authorizeMutation = async () => {
            const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, dependencies.globalAgentEnabled ?? isInstagramAgentGloballyEnabled);
            if (reason) throw new Error(`Operación comercial bloqueada: ${reason}`);
          };
          const semantic = await runSemanticCommerceOrchestrator({
            supabase: dependencies.supabase,
            externalUserId: message.externalUserId,
            eventId: message.eventId,
            receivedAt: message.receivedAt,
            messageText: message.text ?? "Recomiéndame una prenda disponible.",
            conversationContext: commercialContext,
            authorizeMutation,
            interpret: dependencies.interpretCommerce,
          });
          instagramOperationalLog("semantic commerce", { action: semantic.action, mutated: semantic.mutated, legacySalesFallback: false });
          return { responseText: semantic.responseText, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }

        const focusedProduct = ["attribute", "variant_query", "rephrase", "purchase", "commerce_action"].includes(contextual.kind) && commercialContext.lastProductId
          ? await loadFocusedProduct(dependencies.supabase, commercialContext.lastProductId) : null;
        if (contextual.kind === "attribute") {
          const responseText = focusedProduct
            ? formatProductAttribute(focusedProduct, contextual.attribute)
            : "¿De qué producto quieres conocer ese dato?";
          await control.updateConversationContext(message.channel, message.externalUserId, {
            state: "sales", lastAgentQuestion: null, changedAt: message.receivedAt, touchCommercialContext: true,
          });
          return { responseText, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }
        if (contextual.kind === "variant_query") {
          const responseText = focusedProduct ? formatVariantQuery(focusedProduct, contextual.value) : "¿De qué producto quieres consultar esa variante?";
          return { responseText, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }
        if (contextual.kind === "rephrase") {
          return { responseText: rephraseSalesQuestion(commercialContext, focusedProduct), status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }
        let actionableContextual = contextual.kind === "purchase" ? resolvePurchase(focusedProduct, commercialContext) : contextual;
        if (contextual.kind === "quantity") {
          if (!commercialContext.lastVariantId) actionableContextual = { kind: "clarify", response: "¿De cuál producto y variante quieres esa cantidad?", question: null };
          else {
            const alreadySelected = commerceSnapshot?.selectedItems.some((item) => item.variantId === commercialContext.lastVariantId) ?? false;
            actionableContextual = { kind: "tool", tool: alreadySelected ? "set_cart_quantity" : "add_to_cart", input: { variantId: commercialContext.lastVariantId, quantity: contextual.quantity } };
          }
        }
        if (contextual.kind === "commerce_action") {
          actionableContextual = resolveCommerceAction(contextual.action, commerceSnapshot, focusedProduct, commercialContext);
        }

        if (actionableContextual.kind === "snapshot_response") {
          await control.updateConversationContext(message.channel, message.externalUserId, {
            state: "sales", lastAgentQuestion: actionableContextual.question, changedAt: message.receivedAt, touchCommercialContext: true,
          });
          return { responseText: actionableContextual.response, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }

        if (actionableContextual.kind === "clarify") {
          const focusedLabel = actionableContextual.question === "confirm_quantity" && commercialContext.lastVariantId
            ? await loadFocusedVariantLabel(dependencies.supabase, commercialContext.lastVariantId) : null;
          const contextualResponse = focusedLabel
            ? `Perfecto, ¿quieres dejar solo 1 ${focusedLabel}?`
            : actionableContextual.response;
          await control.updateConversationContext(message.channel, message.externalUserId, {
            state: "sales", lastAgentQuestion: actionableContextual.question, changedAt: message.receivedAt, touchCommercialContext: true,
          });
          return { responseText: contextualResponse, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }

        if (actionableContextual.kind === "tool") {
          const authorizeMutation = async () => {
            const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, dependencies.globalAgentEnabled ?? isInstagramAgentGloballyEnabled);
            if (reason) throw new Error(`Operación comercial bloqueada: ${reason}`);
          };
          const toolResult = await executeCommerceTool({ supabase: dependencies.supabase, externalUserId: message.externalUserId, eventId: message.eventId, authorizeMutation }, actionableContextual.tool, actionableContextual.input);
          const action = actionableContextual.tool === "add_to_cart" ? "add_item" : actionableContextual.tool === "set_cart_quantity" ? "set_quantity" : actionableContextual.tool === "create_order" ? "create_order" : "create_payment_link";
          const verifiedResult = actionableContextual.tool === "add_to_cart" || actionableContextual.tool === "set_cart_quantity"
            ? await executeCommerceTool({ supabase: dependencies.supabase, externalUserId: message.externalUserId, eventId: message.eventId, authorizeMutation }, "view_cart", {})
            : toolResult;
          let responseText = formatCommerceResponse(actionableContextual.tool, verifiedResult, actionableContextual.input);
          let nextQuestion = inferAgentQuestion(responseText);
          if (actionableContextual.tool === "create_order" && toolResult.status === "order_created") {
            responseText = `${responseText}\n\nPerfecto 💛 Para generar tu link de pago necesito tu correo. ¿Me lo compartes?`;
            nextQuestion = "ask_email";
          }
          await control.updateConversationContext(message.channel, message.externalUserId, {
            state: "sales", lastAgentQuestion: nextQuestion, lastCommercialAction: action,
            changedAt: message.receivedAt, touchCommercialContext: true,
          });
          return { responseText, status: "processed", conversation, intent: "sales", classifiedAt: message.receivedAt };
        }

        const focusedProductName = actionableContextual.kind === "agent" && commercialContext.lastProductId
          ? await loadFocusedProductName(dependencies.supabase, commercialContext.lastProductId) : null;
        const userText = actionableContextual.kind === "agent" && focusedProductName
          ? `${actionableContextual.text} El producto focal validado es ${focusedProductName}.`
          : actionableContextual.kind === "agent" ? actionableContextual.text : message.text ?? "Recomiéndame algo que combine con la prenda de la imagen.";
        const messages = [...conversation.messages, { role: "user" as const, content: userText }];
        const image = message.imageUrl ? await (dependencies.fetchImage ?? fetchInstagramImage)(message.imageUrl) : undefined;
        instagramOperationalLog("seller agent invocation", { invoked: true, intent: classification.intent });
        instagramDevLog("agent started", { sender: maskedId(message.externalUserId), hasText: Boolean(message.text), hasImage: Boolean(image) });
        const result = await (dependencies.runAgent ?? runSellerAgent)(dependencies.supabase, { messages, image, garmentAnalysis: image ? undefined : conversation.garmentAnalysis, commercialContext }, {
          externalUserId: message.externalUserId,
          eventId: message.eventId,
          authorizeMutation: async () => {
            const reason = await getInstagramAutomationBlockReason(control, message.externalUserId, dependencies.globalAgentEnabled ?? isInstagramAgentGloballyEnabled);
            if (reason) throw new Error(`Operación comercial bloqueada: ${reason}`);
          },
        });
        instagramDevLog("agent completed", { sender: maskedId(message.externalUserId), toolCalls: result.debug.toolCalls, searches: result.debug.searches.length });
        const responseText = formatInstagramResponse(result.message);
        const lastSearch = result.debug.searches.at(-1);
        const lastCommerce = result.debug.commerceOperations.at(-1);
        await control.updateConversationContext(message.channel, message.externalUserId, {
          state: "sales",
          ...(lastSearch?.productIds.length === 1 ? { lastProductId: lastSearch.productIds[0] } : {}),
          ...(lastSearch?.variantIds.length === 1 ? { lastVariantId: lastSearch.variantIds[0] } : {}),
          lastAgentQuestion: inferAgentQuestion(responseText),
          ...(lastCommerce ? { lastCommercialAction: lastCommerce.tool === "add_to_cart" ? "add_item" : lastCommerce.tool === "set_cart_quantity" ? "set_quantity" : lastCommerce.tool === "remove_from_cart" ? "remove_item" : lastCommerce.tool === "view_cart" ? "view_selection" : lastCommerce.tool } : lastSearch ? { lastCommercialAction: "search_catalog" } : {}),
          changedAt: message.receivedAt, touchCommercialContext: true,
        });
        return { responseText, status: "processed", result, conversation: { messages: [...messages, { role: "assistant", content: responseText }], garmentAnalysis: result.garmentAnalysis, needsHuman: false } };
        */
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
    instagramEvents.add({ eventId: message.eventId, externalUserId: message.externalUserId, status: generated.status, receivedAt: message.receivedAt, durationMs: Date.now() - startedAt });
    return { status: generated.status, ...(generated.responseText ? { message: generated.responseText } : {}) };
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
