import type { SupabaseClient } from "@supabase/supabase-js";

export type HandoffReason = "exchange_return" | "after_sales" | "business_proposal" | "human_request" | "unknown_escalation";
export type HandoffCaseStatus = "pending" | "in_progress" | "resolved";
export type NotificationStatus = "pending" | "sent" | "failed" | "not_configured";

export type InstagramHandoffCase = {
  id: string;
  reason: HandoffReason;
  status: HandoffCaseStatus;
  createdAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  notificationStatus: NotificationStatus;
};

type CaseRow = {
  id: string;
  reason: HandoffReason;
  status: HandoffCaseStatus;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  notification_status: NotificationStatus;
};

const caseColumns = "id, reason, status, created_at, acknowledged_at, resolved_at, notification_status";

export function mapHandoffCase(row: CaseRow): InstagramHandoffCase {
  return {
    id: row.id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    notificationStatus: row.notification_status,
  };
}

export async function updateHandoffNotification(
  supabase: SupabaseClient,
  caseId: string,
  result: { status: NotificationStatus; providerId: string | null },
) {
  const now = new Date().toISOString();
  const { error } = await supabase.from("instagram_handoff_cases").update({
    notification_status: result.status,
    notification_attempted_at: now,
    notification_sent_at: result.status === "sent" ? now : null,
    notification_provider_id: result.providerId,
  }).eq("id", caseId);
  if (error) throw new Error(`No se pudo registrar la notificación de handoff: ${error.message}`);
}

export async function setHandoffCaseStatus(supabase: SupabaseClient, caseId: string, action: "take" | "resolve") {
  const now = new Date().toISOString();
  const values = action === "take"
    ? { status: "in_progress", acknowledged_at: now }
    : { status: "resolved", resolved_at: now };
  let query = supabase.from("instagram_handoff_cases").update(values).eq("id", caseId);
  query = action === "take" ? query.eq("status", "pending") : query.in("status", ["pending", "in_progress"]);
  const { data, error } = await query.select(caseColumns).single();
  if (error || !data) throw new Error(`No se pudo ${action === "take" ? "tomar" : "resolver"} el caso de handoff: ${error?.message ?? "estado inválido"}`);
  return mapHandoffCase(data as CaseRow);
}
