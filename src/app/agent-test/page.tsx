"use client";

import { FormEvent, useState } from "react";
import { Icon } from "@/components/icons";

type Message = { role: "user" | "assistant"; content: string };
type DebugCall = { intent: string; tool: string; filters: Record<string, unknown>; resultCount: number };

const welcome: Message = { role: "assistant", content: "Hola, soy la asesora interna de Columpio Mujer. ¿Qué prenda o look te gustaría buscar hoy?" };

export default function AgentTestPage() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState<DebugCall[]>([]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || thinking) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages); setDraft(""); setThinking(true); setError("");
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages }) });
      const data = await response.json() as { message?: string; error?: string; debug?: DebugCall[] };
      if (!response.ok || !data.message) throw new Error(data.error || "No se recibió respuesta del agente.");
      setMessages((current) => [...current, { role: "assistant", content: data.message! }]);
      setDebug(data.debug ?? []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo contactar al agente."); }
    finally { setThinking(false); }
  }

  function reset() { setMessages([welcome]); setDraft(""); setError(""); setDebug([]); }

  return <div className="agent-page"><header className="agent-header"><div><span className="eyebrow">BLOQUE 2A · PRUEBA INTERNA</span><h1>Agente vendedor</h1><p>Asesora conectada al catálogo real de Columpio Mujer.</p></div><button className="secondary-button" onClick={reset}>Nueva conversación</button></header>
    <div className="agent-layout"><section className="chat-panel"><div className="chat-history" aria-live="polite">{messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><small>{message.role === "assistant" ? "Columpio Mujer" : "Tú"}</small><p>{message.content}</p></article>)}{thinking && <article className="chat-message assistant thinking"><small>Columpio Mujer</small><p>Consultando el catálogo…</p></article>}</div>{error && <div className="form-error">{error}</div>}<form className="chat-composer" onSubmit={submit}><label htmlFor="agent-message">Mensaje</label><textarea id="agent-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ej. Busco un blazer negro talla M" maxLength={2000} disabled={thinking}/><button className="primary-button" disabled={thinking || !draft.trim()}>Enviar <Icon name="arrow" size={17}/></button></form></section>
      {process.env.NODE_ENV === "development" && <aside className="agent-debug"><span className="eyebrow">DEBUG · SOLO DESARROLLO</span><h2>Actividad de herramientas</h2>{debug.length === 0 ? <p>Aún no hay llamadas.</p> : debug.map((call, index) => <div className="debug-call" key={index}><small>INTENCIÓN</small><p>{call.intent}</p><strong>{call.tool}</strong><code>{JSON.stringify(call.filters, null, 2)}</code><span>{call.resultCount} resultados</span></div>)}</aside>}
    </div>
  </div>;
}
