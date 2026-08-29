"use client";

import { useCallback, useEffect, useState } from "react";
import { instagramProfileLabel } from "@/lib/channels/instagram/profile-label";

type AutomationMode = "agent" | "temporary_human" | "human_only";
type CaseStatus = "pending" | "in_progress" | "resolved";
type HandoffCase = { id: string; reason: string; status: CaseStatus; createdAt: string };
type Conversation = {
  id: string; externalUserId: string; agentEnabled: boolean; humanOnly: boolean;
  instagramUsername: string | null; humanTakeoverAt: string | null;
  lastInboundAt: string | null; updatedAt: string; handoffCase: HandoffCase | null;
};

const dateFormatter = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const relativeFormatter = new Intl.RelativeTimeFormat("es-CL", { numeric: "auto" });
const maskedId = (id: string) => id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : id;
const currentMode = (item: Conversation): AutomationMode => item.humanOnly ? "human_only" : item.agentEnabled ? "agent" : "temporary_human";
const reasonLabel: Record<string, string> = {
  exchange_return: "Cambio o devolución", after_sales: "Postventa", business_proposal: "Propuesta comercial",
  human_request: "Solicitud de atención humana", unknown_escalation: "Consulta no resuelta",
};
const statusLabel: Record<CaseStatus, string> = { pending: "Pendiente", in_progress: "En atención", resolved: "Resuelto" };
function caseAge(createdAt: string) {
  const hours = Math.round((Date.parse(createdAt) - Date.now()) / 3_600_000);
  if (Math.abs(hours) < 24) return relativeFormatter.format(hours, "hour");
  return relativeFormatter.format(Math.round(hours / 24), "day");
}

export default function InstagramConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [changingId, setChangingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/instagram/conversations", { cache: "no-store" });
    const body = await response.json() as { conversations?: Conversation[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar las conversaciones.");
    setConversations(body.conversations ?? []);
  }, []);

  useEffect(() => { queueMicrotask(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Error inesperado.")).finally(() => setLoading(false))); }, [load]);

  async function mutate(url: string, body: object, id: string) {
    setChangingId(id); setError("");
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo cambiar el estado.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error inesperado."); }
    finally { setChangingId(""); }
  }

  const setMode = (item: Conversation, mode: AutomationMode) => mutate(`/api/instagram/conversations/${encodeURIComponent(item.id)}`, { mode }, item.id);
  const setCaseStatus = (item: Conversation, action: "take" | "resolve") => mutate(`/api/instagram/handoff-cases/${encodeURIComponent(item.handoffCase!.id)}`, { action }, item.id);

  return <div className="page-wrap handoff-page"><header className="page-header"><div><span className="eyebrow">INSTAGRAM</span><h1>Handoff humano</h1><p>Gestiona los casos derivados y la atención automática de cada conversación.</p></div></header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state">Cargando conversaciones…</div> : <div className="handoff-list">{conversations.map((item) => {
      const mode = currentMode(item); const changing = changingId === item.id; const handoffCase = item.handoffCase;
      return <article className="handoff-row" key={item.id}>
        <div><small>USUARIO DE INSTAGRAM</small><strong>{instagramProfileLabel(item.instagramUsername)}</strong><span title={item.externalUserId}>IGSID: {maskedId(item.externalUserId)}</span></div>
        <div><small>ÚLTIMA ACTIVIDAD</small><strong>{item.lastInboundAt ? dateFormatter.format(new Date(item.lastInboundAt)) : "Sin actividad registrada"}</strong></div>
        <div><small>CASO</small>{handoffCase ? <><strong>{reasonLabel[handoffCase.reason] ?? handoffCase.reason}</strong><span>{statusLabel[handoffCase.status]} · {caseAge(handoffCase.createdAt)}</span></> : <span>Sin caso asociado</span>}</div>
        <div><small>ESTADO DEL AGENTE</small><i className={mode === "agent" ? "badge active" : mode === "human_only" ? "badge permanent" : "badge handoff"}>{mode === "agent" ? "Agente activo" : mode === "human_only" ? "Siempre humano" : "Modo humano temporal"}</i></div>
        <div className="handoff-actions">
          {handoffCase?.status === "pending" && <button className="secondary-button" disabled={changing} onClick={() => void setCaseStatus(item, "take")}>Tomar caso</button>}
          {(handoffCase?.status === "pending" || handoffCase?.status === "in_progress") && <button className="secondary-button" disabled={changing} onClick={() => void setCaseStatus(item, "resolve")}>Marcar resuelto</button>}
          {mode === "temporary_human" && (!handoffCase || handoffCase.status === "resolved") && <button className="primary-button" disabled={changing} onClick={() => void setMode(item, "agent")}>Volver al agente</button>}
          {mode !== "human_only" && <button className="text-button permanent-button" disabled={changing} onClick={() => void setMode(item, "human_only")}>Siempre humano</button>}
          {changing && <span>Guardando…</span>}
        </div>
      </article>;
    })}{conversations.length === 0 && <div className="empty-state">Aún no hay conversaciones de Instagram registradas.</div>}</div>}
  </div>;
}
