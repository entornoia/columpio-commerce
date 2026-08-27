import type { AgentChatMessage } from "../../agent/runner";
import type { GarmentAnalysis } from "../../agent/garment-analysis";

export type IncomingCommerceMessage = {
  channel: "instagram";
  eventId: string;
  externalUserId: string;
  externalConversationId: string;
  text: string | null;
  imageUrl: string | null;
  metadata?: { storyUrl?: string; storyId?: string; sharedUrl?: string; referral?: Record<string, unknown> };
  receivedAt: string;
};

export type InstagramConversation = {
  messages: AgentChatMessage[];
  garmentAnalysis: GarmentAnalysis | null;
  needsHuman: boolean;
};

export type InstagramEventLog = {
  eventId: string;
  externalUserId: string;
  status: "received" | "ignored" | "duplicate" | "paused" | "human_only" | "handoff_error" | "processed" | "escalated" | "failed";
  receivedAt: string;
  durationMs?: number;
  toolCalls?: number;
  resultCount?: number;
  error?: string;
};
