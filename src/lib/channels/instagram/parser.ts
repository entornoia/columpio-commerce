import type { IncomingCommerceMessage } from "./types";

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

export function parseInstagramWebhook(payload: unknown, ownAccountId?: string): IncomingCommerceMessage[] {
  const root = record(payload);
  if (!root || root.object !== "instagram" || !Array.isArray(root.entry)) return [];
  const messages: IncomingCommerceMessage[] = [];
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (!entry || !Array.isArray(entry.messaging)) continue;
    for (const rawEvent of entry.messaging) {
      const event = record(rawEvent);
      const sender = record(event?.sender);
      const recipient = record(event?.recipient);
      const message = record(event?.message);
      if (!event || !sender || !recipient || !message || typeof sender.id !== "string" || typeof recipient.id !== "string" || typeof message.mid !== "string") continue;
      if (message.is_echo === true || message.is_self === true || sender.id === ownAccountId) continue;
      const attachments = Array.isArray(message.attachments) ? message.attachments : [];
      const image = attachments.map(record).find((attachment) => attachment?.type === "image");
      const imageUrl = record(image?.payload)?.url;
      const replyStory = record(record(message.reply_to)?.story);
      const shared = attachments.map(record).find((attachment) => attachment?.type === "share");
      const sharedUrl = record(shared?.payload)?.url;
      const referral = record(event.referral);
      const text = typeof message.text === "string" && message.text.trim() ? message.text.trim().slice(0, 2_000) : null;
      if (!text && typeof imageUrl !== "string") continue;
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
