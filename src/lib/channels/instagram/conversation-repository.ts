import type { SupabaseClient } from "@supabase/supabase-js";

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
};

export type InstagramAutomationState = { agentEnabled: boolean; humanOnly: boolean };
export type InstagramAutomationMode = "agent" | "temporary_human" | "human_only";

export function automationModeValues(mode: InstagramAutomationMode, changedAt = new Date().toISOString()) {
  const agentEnabled = mode === "agent";
  return {
    agent_enabled: agentEnabled,
    human_only: mode === "human_only",
    human_takeover_at: agentEnabled ? null : changedAt,
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
};

const columns = "id, channel, external_user_id, agent_enabled, human_only, instagram_username, profile_checked_at, human_takeover_at, last_inbound_at, updated_at";

function mapConversation(row: ConversationRow): InstagramConversationControlRecord {
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
  };
}

function databaseError(action: string, error: { message: string }) {
  return new Error(`No se pudo ${action} el handoff de Instagram: ${error.message}`);
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
  };
}

export async function listInstagramConversations(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("instagram_conversations").select(columns)
    .eq("channel", "instagram").order("last_inbound_at", { ascending: false, nullsFirst: false });
  if (error) throw databaseError("listar", error);
  return ((data ?? []) as ConversationRow[]).map(mapConversation);
}

export async function setInstagramAutomationMode(supabase: SupabaseClient, id: string, mode: InstagramAutomationMode) {
  const { data, error } = await supabase.from("instagram_conversations").update(automationModeValues(mode)).eq("id", id).eq("channel", "instagram").select(columns).single();
  if (error || !data) throw databaseError("cambiar", error ?? { message: "conversación inexistente" });
  return mapConversation(data as ConversationRow);
}
