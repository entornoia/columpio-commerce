import type { SupabaseClient } from "@supabase/supabase-js";
import { instagramOperationalLog } from "./logging.ts";
import type { HandoffReason, InstagramHandoffCase } from "./handoff-cases";
import type { ConversationContextPatch, InstagramAgentQuestion, InstagramCommercialAction, InstagramConversationContext, InstagramConversationState } from "./conversation-state.ts";

export type InstagramConversationControlRecord = {
  id: string;
  channel: "instagram";
  externalUserId: string;
  agentEnabled: boolean;
  humanOnly: boolean;
  instagramUsername: string | null;
  profileCheckedAt: string | null;
  humanTakeoverAt: string | null;
  lastInboundAt: string | null;
  updatedAt: string;
  handoffCase: InstagramHandoffCase | null;
  conversationState: InstagramConversationState;
};

export type IncomingConversationMetadata = {
  channel: "instagram";
  externalUserId: string;
  eventId: string;
  receivedAt: string;
};

export type InstagramConversationControl = {
  registerIncoming: (message: IncomingConversationMetadata) => Promise<void>;
  getAutomationState: (channel: "instagram", externalUserId: string) => Promise<InstagramAutomationState>;
  getIntentState: (channel: "instagram", externalUserId: string) => Promise<InstagramIntentState>;
  getConversationContext: (channel: "instagram", externalUserId: string) => Promise<InstagramConversationContext>;
  updateConversationContext: (channel: "instagram", externalUserId: string, patch: ConversationContextPatch) => Promise<InstagramConversationContext>;
  recordIntent: (channel: "instagram", externalUserId: string, intent: InstagramIntent, classifiedAt: string) => Promise<void>;
  pauseTemporarily: (channel: "instagram", externalUserId: string, changedAt?: string) => Promise<void>;
  transitionToTemporaryHuman: (channel: "instagram", externalUserId: string, eventId: string, reason: HandoffReason, classifiedAt: string, changedAt?: string) => Promise<{ transitioned: boolean; caseId: string | null }>;
};

export type InstagramAutomationState = { agentEnabled: boolean; humanOnly: boolean };
export type InstagramIntent = "sales" | "after_sales" | "exchange_return" | "order_tracking" | "general_info" | "business_proposal" | "social_reaction" | "human_request" | "unknown";
export type InstagramIntentState = { lastIntent: InstagramIntent | null; lastIntentAt: string | null };
export type InstagramAutomationMode = "agent" | "temporary_human" | "human_only";

export function automationModeValues(mode: InstagramAutomationMode, changedAt = new Date().toISOString()) {
  const agentEnabled = mode === "agent";
  return {
    agent_enabled: agentEnabled,
    human_only: mode === "human_only",
    human_takeover_at: agentEnabled ? null : changedAt,
    conversation_state: agentEnabled ? "unscoped" : "human",
    conversation_state_at: changedAt,
    ...(agentEnabled ? { last_product_id: null, last_variant_id: null, last_agent_question: null, last_commercial_action: null, commercial_context_at: null, focus_product_id: null, focus_variant_id: null, focus_category: null, focus_updated_at: null } : {}),
    updated_at: changedAt,
  };
}

type ConversationRow = {
  id: string;
  channel: "instagram";
  external_user_id: string;
  agent_enabled: boolean;
  human_only: boolean;
  instagram_username: string | null;
  profile_checked_at: string | null;
  human_takeover_at: string | null;
  last_inbound_at: string | null;
  updated_at: string;
  conversation_state: InstagramConversationState;
  instagram_handoff_cases?: Array<{
    id: string;
    reason: HandoffReason;
    status: "pending" | "in_progress" | "resolved";
    created_at: string;
    acknowledged_at: string | null;
    resolved_at: string | null;
    notification_status: "pending" | "sent" | "failed" | "not_configured";
  }>;
};

const columns = "id, channel, external_user_id, agent_enabled, human_only, instagram_username, profile_checked_at, human_takeover_at, last_inbound_at, updated_at, conversation_state";
const listColumns = `${columns}, instagram_handoff_cases(id, reason, status, created_at, acknowledged_at, resolved_at, notification_status)`;

function mapConversation(row: ConversationRow): InstagramConversationControlRecord {
  const cases = [...(row.instagram_handoff_cases ?? [])].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const currentCase = cases.find((item) => item.status !== "resolved") ?? cases[0] ?? null;
  return {
    id: row.id,
    channel: row.channel,
    externalUserId: row.external_user_id,
    agentEnabled: row.agent_enabled,
    humanOnly: row.human_only,
    instagramUsername: row.instagram_username,
    profileCheckedAt: row.profile_checked_at,
    humanTakeoverAt: row.human_takeover_at,
    lastInboundAt: row.last_inbound_at,
    updatedAt: row.updated_at,
    handoffCase: currentCase ? {
      id: currentCase.id,
      reason: currentCase.reason,
      status: currentCase.status,
      createdAt: currentCase.created_at,
      acknowledgedAt: currentCase.acknowledged_at,
      resolvedAt: currentCase.resolved_at,
      notificationStatus: currentCase.notification_status,
    } : null,
    conversationState: row.conversation_state,
  };
}

function databaseError(action: string, error: { message: string }) {
  return new Error(`No se pudo ${action} el handoff de Instagram: ${error.message}`);
}

function sameInstant(left: unknown, right: string) {
  return typeof left === "string" && Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
}

export function createInstagramConversationControl(supabase: SupabaseClient): InstagramConversationControl {
  return {
    async registerIncoming(message) {
      const { error: insertError } = await supabase.from("instagram_conversations").upsert({
        channel: message.channel,
        external_user_id: message.externalUserId,
        last_inbound_at: message.receivedAt,
        last_event_id: message.eventId,
      }, { onConflict: "channel,external_user_id", ignoreDuplicates: true });
      if (insertError) throw databaseError("registrar", insertError);

      const { error: updateError } = await supabase.from("instagram_conversations").update({
        last_inbound_at: message.receivedAt,
        last_event_id: message.eventId,
        updated_at: new Date().toISOString(),
      }).eq("channel", message.channel).eq("external_user_id", message.externalUserId);
      if (updateError) throw databaseError("actualizar", updateError);
    },
    async getAutomationState(channel, externalUserId) {
      const { data, error } = await supabase.from("instagram_conversations")
        .select("agent_enabled, human_only").eq("channel", channel).eq("external_user_id", externalUserId).single();
      if (error || !data) throw databaseError("consultar", error ?? { message: "conversación inexistente" });
      if (typeof data.agent_enabled !== "boolean" || typeof data.human_only !== "boolean") throw databaseError("consultar", { message: "estado incompleto" });
      return { agentEnabled: data.agent_enabled, humanOnly: data.human_only };
    },
    async getIntentState(channel, externalUserId) {
      const { data, error } = await supabase.from("instagram_conversations")
        .select("last_intent, last_intent_at").eq("channel", channel).eq("external_user_id", externalUserId).single();
      if (error || !data) throw databaseError("consultar intención", error ?? { message: "conversación inexistente" });
      return { lastIntent: (data.last_intent ?? null) as InstagramIntent | null, lastIntentAt: typeof data.last_intent_at === "string" ? data.last_intent_at : null };
    },
    async getConversationContext(channel, externalUserId) {
      const { data, error } = await supabase.from("instagram_conversations")
        .select("conversation_state, conversation_state_at, last_product_id, last_variant_id, last_agent_question, last_commercial_action, commercial_context_at")
        .eq("channel", channel).eq("external_user_id", externalUserId).single();
      if (error || !data) throw databaseError("consultar contexto", error ?? { message: "conversación inexistente" });
      return {
        state: data.conversation_state as InstagramConversationState,
        stateAt: data.conversation_state_at as string,
        lastProductId: typeof data.last_product_id === "string" ? data.last_product_id : null,
        lastVariantId: typeof data.last_variant_id === "string" ? data.last_variant_id : null,
        lastAgentQuestion: (data.last_agent_question ?? null) as InstagramAgentQuestion | null,
        lastCommercialAction: (data.last_commercial_action ?? null) as InstagramCommercialAction | null,
        commercialContextAt: typeof data.commercial_context_at === "string" ? data.commercial_context_at : null,
      };
    },
    async updateConversationContext(channel, externalUserId, patch) {
      const values: Record<string, unknown> = { updated_at: patch.changedAt };
      if (patch.state !== undefined) { values.conversation_state = patch.state; values.conversation_state_at = patch.changedAt; }
      if (patch.lastProductId !== undefined) values.last_product_id = patch.lastProductId;
      if (patch.lastVariantId !== undefined) values.last_variant_id = patch.lastVariantId;
      if (patch.lastAgentQuestion !== undefined) values.last_agent_question = patch.lastAgentQuestion;
      if (patch.lastCommercialAction !== undefined) values.last_commercial_action = patch.lastCommercialAction;
      if (patch.touchCommercialContext) values.commercial_context_at = patch.changedAt;
      const { error } = await supabase.from("instagram_conversations").update(values)
        .eq("channel", channel).eq("external_user_id", externalUserId);
      if (error) throw databaseError("actualizar contexto", error);
      return this.getConversationContext(channel, externalUserId);
    },
    async recordIntent(channel, externalUserId, intent, classifiedAt) {
      const { data, error } = await supabase.from("instagram_conversations").update({ last_intent: intent, last_intent_at: classifiedAt })
        .eq("channel", channel).eq("external_user_id", externalUserId).select("last_intent, last_intent_at").single();
      if (error || !data) {
        instagramOperationalLog("intent persistence", { success: false }, "error");
        throw databaseError("registrar intención", error ?? { message: "conversación inexistente" });
      }
      if (data.last_intent !== intent || !sameInstant(data.last_intent_at, classifiedAt)) {
        instagramOperationalLog("intent persistence", { success: false, expected: { lastIntent: intent, lastIntentAtPresent: true }, actual: { lastIntent: data.last_intent ?? null, lastIntentAtPresent: typeof data.last_intent_at === "string" } }, "error");
        throw databaseError("registrar intención", { message: "la verificación persistida no coincide" });
      }
      instagramOperationalLog("intent persistence", { success: true, intent });
    },
    async pauseTemporarily(channel, externalUserId, changedAt = new Date().toISOString()) {
      const { data, error } = await supabase.from("instagram_conversations").update({ agent_enabled: false, human_only: false, human_takeover_at: changedAt, updated_at: changedAt })
        .eq("channel", channel).eq("external_user_id", externalUserId).select("agent_enabled, human_only, human_takeover_at").single();
      if (error || !data) {
        instagramOperationalLog("handoff persistence", { success: false }, "error");
        throw databaseError("pausar", error ?? { message: "conversación inexistente" });
      }
      if (data.agent_enabled !== false || data.human_only !== false || typeof data.human_takeover_at !== "string") {
        instagramOperationalLog("handoff persistence", { success: false }, "error");
        throw databaseError("pausar", { message: "estado persistido inválido" });
      }
      instagramOperationalLog("handoff persistence", { success: true, agentEnabled: data.agent_enabled, humanOnly: data.human_only, humanTakeoverAtPresent: true });
    },
    async transitionToTemporaryHuman(channel, externalUserId, eventId, reason, classifiedAt, changedAt = new Date().toISOString()) {
      if (channel !== "instagram") throw databaseError("persistir intención y pausa", { message: "canal inválido" });
      const { data, error } = await supabase.rpc("transition_instagram_conversation_to_human", {
        p_external_user_id: externalUserId,
        p_trigger_event_id: eventId,
        p_reason: reason,
        p_classified_at: classifiedAt,
        p_changed_at: changedAt,
      }).single();
      if (error || !data) {
        instagramOperationalLog("atomic handoff persistence", { success: false }, "error");
        throw databaseError("persistir intención, pausa y caso", error ?? { message: "sin respuesta" });
      }
      const row = data as { transitioned?: unknown; case_id?: unknown; agent_enabled?: unknown; human_only?: unknown; human_takeover_at?: unknown };
      const transitioned = row.transitioned === true;
      const validState = row.agent_enabled === false && typeof row.human_only === "boolean" && typeof row.human_takeover_at === "string";
      if (!validState || (transitioned && (row.human_only !== false || typeof row.case_id !== "string"))) {
        instagramOperationalLog("atomic handoff persistence", { success: false, transitioned }, "error");
        throw databaseError("persistir intención, pausa y caso", { message: "estado persistido inválido" });
      }
      instagramOperationalLog("atomic handoff persistence", { success: true, transitioned, caseCreated: transitioned });
      return { transitioned, caseId: typeof row.case_id === "string" ? row.case_id : null };
    },
  };
}

export async function listInstagramConversations(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("instagram_conversations").select(listColumns)
    .eq("channel", "instagram").order("last_inbound_at", { ascending: false, nullsFirst: false });
  if (error) throw databaseError("listar", error);
  const priority = { pending: 0, in_progress: 1, resolved: 2 } as const;
  return ((data ?? []) as ConversationRow[]).map(mapConversation).sort((left, right) => {
    const leftPriority = left.handoffCase ? priority[left.handoffCase.status] : 3;
    const rightPriority = right.handoffCase ? priority[right.handoffCase.status] : 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return Date.parse(right.handoffCase?.createdAt ?? right.lastInboundAt ?? right.updatedAt)
      - Date.parse(left.handoffCase?.createdAt ?? left.lastInboundAt ?? left.updatedAt);
  });
}

export async function setInstagramAutomationMode(supabase: SupabaseClient, id: string, mode: InstagramAutomationMode) {
  if (mode === "agent") {
    const { data: openCase, error: caseError } = await supabase.from("instagram_handoff_cases")
      .select("id").eq("conversation_id", id).in("status", ["pending", "in_progress"]).maybeSingle();
    if (caseError) throw databaseError("comprobar casos abiertos antes de reactivar", caseError);
    if (openCase) throw databaseError("reactivar", { message: "primero debes resolver el caso abierto" });
  }
  let query = supabase.from("instagram_conversations").update(automationModeValues(mode)).eq("id", id).eq("channel", "instagram");
  if (mode === "agent") query = query.eq("human_only", false);
  const { data, error } = await query.select(columns).single();
  if (error || !data) throw databaseError("cambiar", error ?? { message: "conversación inexistente" });
  return mapConversation(data as ConversationRow);
}
