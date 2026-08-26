import type { IncomingCommerceMessage } from "./types";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

export type InstagramIgnoredEvent = { reason: string; eventTypes: string[] };

export function parseInstagramWebhookWithDiagnostics(payload: unknown, ownAccountId?: string) {
  const ignored: InstagramIgnoredEvent[] = [];
  const messages = parseInstagramWebhook(payload, ownAccountId, ignored);
  return { messages, ignored };
}

export function parseInstagramWebhook(payload: unknown, ownAccountId?: string, ignored: InstagramIgnoredEvent[] = []): IncomingCommerceMessage[] {
  const root = record(payload);
  if (!root || root.object !== "instagram" || !Array.isArray(root.entry)) {
    ignored.push({ reason: "payload_not_instagram", eventTypes: [] });
    return [];
  }
  const messages: IncomingCommerceMessage[] = [];
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (!entry || !Array.isArray(entry.messaging)) continue;
    for (const rawEvent of entry.messaging) {
      const event = record(rawEvent);
      const sender = record(event?.sender);
      const recipient = record(event?.recipient);
      const message = record(event?.message);
      const eventTypes = event ? Object.keys(event).filter((key) => !["sender", "recipient", "timestamp", "prior_message"].includes(key)) : [];
      if (!event || !message) { ignored.push({ reason: `unsupported_event:${eventTypes.join("+") || "unknown"}`, eventTypes }); continue; }
      if (!sender || typeof sender.id !== "string") { ignored.push({ reason: "missing_sender", eventTypes }); continue; }
      if (!recipient || typeof recipient.id !== "string") { ignored.push({ reason: "missing_recipient", eventTypes }); continue; }
      if (typeof message.mid !== "string") { ignored.push({ reason: "missing_message_mid", eventTypes }); continue; }
      if (message.is_echo === true) { ignored.push({ reason: "message_is_echo", eventTypes }); continue; }
      if (message.is_self === true) { ignored.push({ reason: "message_is_self", eventTypes }); continue; }
      if (sender.id === ownAccountId) { ignored.push({ reason: "sender_is_business_account", eventTypes }); continue; }
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const image = attachments.map(record).find((attachment) => attachment?.type === "image");
      const imageUrl = record(image?.payload)?.url;
      const replyStory = record(record(message.reply_to)?.story);
      const shared = attachments.map(record).find((attachment) => attachment?.type === "share");
      const sharedUrl = record(shared?.payload)?.url;
      const referral = record(event.referral);
      const text = typeof message.text === "string" && message.text.trim() ? message.text.trim().slice(0, 2_000) : null;
      if (!text && typeof imageUrl !== "string") { ignored.push({ reason: "message_without_text_or_image", eventTypes }); continue; }
      const timestamp = typeof event.timestamp === "number" ? event.timestamp : Date.now();
      messages.push({
        channel: "instagram",
        eventId: message.mid,
        externalUserId: sender.id,
        externalConversationId: sender.id,
        text,
        imageUrl: typeof imageUrl === "string" ? imageUrl : null,
        ...((replyStory || typeof sharedUrl === "string" || referral) ? { metadata: {
          ...(typeof replyStory?.url === "string" ? { storyUrl: replyStory.url } : {}),
          ...(typeof replyStory?.id === "string" ? { storyId: replyStory.id } : {}),
          ...(typeof sharedUrl === "string" ? { sharedUrl } : {}),
          ...(referral ? { referral } : {}),
        } } : {}),
        receivedAt: new Date(timestamp).toISOString(),
      });
    }
  }
  return messages;
}
