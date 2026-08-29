import type { HandoffReason, NotificationStatus } from "./handoff-cases";

export type HandoffNotificationData = {
  caseId: string;
  reason: HandoffReason;
  instagramUsername: string | null;
  maskedInstagramId: string;
  createdAt: string;
};

export type HandoffNotificationResult = {
  status: NotificationStatus;
  providerId: string | null;
};

export async function sendHandoffNotification(
  caseData: HandoffNotificationData,
  deliver?: (input: HandoffNotificationData & { to: string; from: string }) => Promise<{ providerId: string }>,
): Promise<HandoffNotificationResult> {
  const to = process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL?.trim();
  const from = process.env.HUMAN_HANDOFF_EMAIL_FROM?.trim();
  if (!to || !from || !deliver) return { status: "not_configured", providerId: null };
  try {
    const result = await deliver({ ...caseData, to, from });
    return { status: "sent", providerId: result.providerId };
  } catch {
    return { status: "failed", providerId: null };
  }
}
