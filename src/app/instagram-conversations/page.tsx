"use client";

import { useCallback, useEffect, useState } from "react";
import { instagramProfileLabel } from "@/lib/channels/instagram/profile-label";

type AutomationMode = "agent" | "temporary_human" | "human_only";
type Conversation = { id: string; externalUserId: string; agentEnabled: boolean; humanOnly: boolean; instagramUsername: string | null; profileCheckedAt: string | null; humanTakeoverAt: string | null; lastInboundAt: string | null; updatedAt: string };
const dateFormatter = new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" });
const maskedId = (id: string) => id.length > 8 ? `${id.slice(0, 4)}••••${id.slice(-4)}` : id;
const currentMode = (conversation: Conversation): AutomationMode => conversation.humanOnly ? "human_only" : conversation.agentEnabled ? "agent" : "temporary_human";

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

  async function setMode(conversation: Conversation, mode: AutomationMode) {
    setChangingId(conversation.id); setError("");
    try {
      const response = await fetch(`/api/instagram/conversations/${encodeURIComponent(conversation.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const body = await response.json() as { conversation?: Conversation; error?: string };
      if (!response.ok || !body.conversation) throw new Error(body.error ?? "No se pudo cambiar el estado.");
      setConversations((current) => current.map((item) => item.id === conversation.id ? body.conversation! : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Error inesperado."); }
    finally { setChangingId(""); }
  }

  return <div className="page-wrap handoff-page"><header className="page-header"><div><span className="eyebrow">INSTAGRAM</span><h1>Handoff humano</h1><p>Controla la atención automática de forma independiente para cada conversación.</p></div></header>
    {error && <div className="form-error" role="alert">{error}</div>}
    {loading ? <div className="loading-state">Cargando conversaciones…</div> : <div className="handoff-list">{conversations.map((conversation) => {
      const mode = currentMode(conversation); const changing = changingId === conversation.id;
      return <article className="handoff-row" key={conversation.id}>
        <div><small>USUARIO DE INSTAGRAM</small><strong>{instagramProfileLabel(conversation.instagramUsername)}</strong><span title={conversation.externalUserId}>IGSID: {maskedId(conversation.externalUserId)}</span></div>
        <div><small>ÚLTIMA ACTIVIDAD</small><strong>{conversation.lastInboundAt ? dateFormatter.format(new Date(conversation.lastInboundAt)) : "Sin actividad registrada"}</strong></div>
        <div><small>ESTADO</small><i className={mode === "agent" ? "badge active" : mode === "human_only" ? "badge permanent" : "badge handoff"}>{mode === "agent" ? "Agente activo" : mode === "human_only" ? "Siempre humano" : "Modo humano temporal"}</i>{conversation.humanTakeoverAt && <span>Desde {dateFormatter.format(new Date(conversation.humanTakeoverAt))}</span>}</div>
        <div className="handoff-actions">
          {mode === "agent" && <><button className="secondary-button pause-button" disabled={changing} onClick={() => void setMode(conversation, "temporary_human")}>Pausar agente</button><button className="text-button permanent-button" disabled={changing} onClick={() => void setMode(conversation, "human_only")}>Siempre humano</button></>}
          {mode === "temporary_human" && <><button className="primary-button" disabled={changing} onClick={() => void setMode(conversation, "agent")}>Reactivar agente</button><button className="text-button permanent-button" disabled={changing} onClick={() => void setMode(conversation, "human_only")}>Siempre humano</button></>}
          {mode === "human_only" && <button className="primary-button" disabled={changing} onClick={() => void setMode(conversation, "agent")}>Volver al agente</button>}
          {changing && <span>Guardando…</span>}
        </div>
      </article>;
    })}{conversations.length === 0 && <div className="empty-state">Aún no hay conversaciones de Instagram registradas.</div>}</div>}
  </div>;
}
