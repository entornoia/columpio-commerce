"use client";

import { useState } from "react";
import Link from "next/link";

type EventItem = { eventId: string; externalUserId: string; status: string; durationMs?: number; toolCalls?: number };

export default function InstagramTestPage() {
  const [userId, setUserId] = useState("fixture-user-a");
  const [messageId, setMessageId] = useState(() => `fixture-${Date.now()}`);
  const [text, setText] = useState("¿Tienen Blazer Emilia negro talla M?");
  const [fixtureImage, setFixtureImage] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const loadEvents = async () => { const response = await fetch("/api/channels/instagram/test"); if (response.ok) setEvents((await response.json()).events); };
  async function runFixture() {
    setLoading(true); setResult(null);
    const attachments = fixtureImage ? [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/fixture.jpg" } }] : undefined;
    const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: userId }, recipient: { id: "business-test" }, timestamp: Date.now(), message: { mid: messageId, text: text || undefined, attachments } }] }] };
    const response = await fetch("/api/channels/instagram/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload, fixtureImage }) });
    setResult(await response.json()); setLoading(false); await loadEvents();
  }
  return <main className="agent-page"><header className="agent-header"><div><span className="eyebrow">BLOQUE 3A · FIXTURES</span><h1>Instagram DM</h1><p>Mismo parser y agente del webhook, sin enviar mensajes reales a Meta.</p></div><Link className="secondary-button" href="/agent-test">Volver al agente</Link></header><div className="agent-layout"><section className="panel"><div className="form-grid"><label>Usuario externo<input value={userId} onChange={(event) => setUserId(event.target.value)}/></label><label>Message ID<input value={messageId} onChange={(event) => setMessageId(event.target.value)}/></label><label className="span-2">Mensaje<textarea value={text} onChange={(event) => setText(event.target.value)}/></label><label className="span-2">Imagen opcional<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return setFixtureImage(null); const reader = new FileReader(); reader.onload = () => setFixtureImage(String(reader.result)); reader.readAsDataURL(file); }}/></label><label className="span-2">Data URL de fixture<textarea aria-label="Data URL de fixture" value={fixtureImage ?? ""} onChange={(event) => setFixtureImage(event.target.value || null)} placeholder="data:image/png;base64,…"/></label></div><button className="primary-button" disabled={loading} onClick={() => void runFixture()}>{loading ? "Procesando…" : "Ejecutar fixture"}</button>{result ? <code>{JSON.stringify(result, null, 2)}</code> : null}</section><aside className="agent-debug"><span className="eyebrow">EVENTOS RECIENTES</span><h2>Observabilidad</h2>{events.length ? events.map((event) => <div className="debug-call" key={`${event.eventId}-${event.status}`}><strong>{event.status}</strong><span>{event.externalUserId.replace(/.(?=.{3})/g, "•")}</span><small>{event.eventId} · {event.toolCalls ?? 0} tools · {event.durationMs ?? 0} ms</small></div>) : <p>Aún no hay eventos.</p>}</aside></div></main>;
}
