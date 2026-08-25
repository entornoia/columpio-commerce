"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons";
import type { GarmentAnalysis, TemporaryGarment } from "@/lib/agent/garment-analysis";
import { ALLOWED_GARMENT_IMAGE_TYPES, MAX_GARMENT_IMAGE_BYTES, MAX_TEMPORARY_CLOSET_SIZE } from "@/lib/agent/config";

type Attachment = { id: string; name: string; dataUrl: string };
type Message = { role: "user" | "assistant"; content: string; imagePreviews?: string[] };
type DebugSearch = { intent: string; tool: string; filters: Record<string, unknown>; resultCount: number };
type Metrics = { modelCalls: number; toolCalls: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; durationMs: number };
type AgentDebug = { experience: "texto" | "2B" | "2C"; imageCount: number; imageReceived: boolean; garmentAnalysis: GarmentAnalysis | null; temporaryCloset: TemporaryGarment[] | null; intent?: string; searches: DebugSearch[]; recommendedProducts: { name: string; sku: string }[]; modelCalls: number; toolCalls: number; usage: Omit<Metrics, "modelCalls" | "toolCalls" | "estimatedCostUsd" | "durationMs">; estimatedCostUsd: number; costFullyEstimated: boolean; durationMs: number };

const welcome: Message = { role: "assistant", content: "Hola, soy la asesora interna de Columpio Mujer. Puedes contarme qué buscas o adjuntar fotos de prendas que quieras combinar." };
const emptyMetrics: Metrics = { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, durationMs: 0 };

function readFile(file: File) {
  return new Promise<Attachment>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, dataUrl: String(reader.result) }); reader.onerror = reject; reader.readAsDataURL(file); });
}

export default function AgentTestPage() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [garmentAnalysis, setGarmentAnalysis] = useState<GarmentAnalysis | null>(null);
  const [temporaryCloset, setTemporaryCloset] = useState<TemporaryGarment[] | null>(null);
  const [multiEnabled, setMultiEnabled] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState<AgentDebug | null>(null);
  const [sessionMetrics, setSessionMetrics] = useState<Metrics>(emptyMetrics);
  const [commercial, setCommercial] = useState({ purchaseIntent: false, selectedProduct: "", saleMade: false });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { fetch("/api/agent").then((response) => response.ok ? response.json() : null).then((data) => setMultiEnabled(Boolean(data?.multiGarmentStyling))).catch(() => undefined); }, []);

  async function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]; event.target.value = "";
    if (!files.length) return;
    if (files.some((file) => !(ALLOWED_GARMENT_IMAGE_TYPES as readonly string[]).includes(file.type))) return setError("Solo se aceptan imágenes JPEG, PNG o WebP.");
    if (files.some((file) => file.size > MAX_GARMENT_IMAGE_BYTES)) return setError("Cada imagen debe pesar como máximo 5 MB.");
    const nextCount = multiMode ? attachments.length + files.length : 1;
    if (nextCount > MAX_TEMPORARY_CLOSET_SIZE) return setError("Puedes analizar hasta 4 prendas por consulta.");
    try { const loaded = await Promise.all((multiMode ? files : files.slice(0, 1)).map(readFile)); setAttachments((current) => multiMode ? [...current, ...loaded] : loaded); setError(""); }
    catch { setError("No se pudo leer una de las imágenes."); }
  }

  function removeAttachment(id: string) { setAttachments((current) => current.filter((item) => item.id !== id)); }
  function toggleMultiMode() { setMultiMode((current) => !current); setAttachments([]); setError(""); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && !attachments.length) || thinking) return;
    if (multiMode && attachments.length === 1) return setError("Adjunta entre 2 y 4 prendas para analizar varias.");
    const userContent = content || (multiMode ? "¿Qué única pieza comprarías para potenciar estas prendas?" : "¿Con qué combinarías esta prenda?");
    const previews = attachments.map((item) => item.dataUrl);
    const nextMessages = [...messages, { role: "user" as const, content: userContent, ...(previews.length ? { imagePreviews: previews } : {}) }];
    setMessages(nextMessages); setDraft(""); setThinking(true); setError("");
    try {
      const body = { messages: nextMessages.map(({ role, content: text }) => ({ role, content: text })), garmentAnalysis, temporaryCloset, ...(attachments.length ? multiMode ? { images: previews } : { image: previews[0] } : {}) };
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { message?: string; error?: string; garmentAnalysis?: GarmentAnalysis | null; temporaryCloset?: TemporaryGarment[] | null; debug?: AgentDebug };
      if (!response.ok || !data.message) throw new Error(data.error || "No se recibió respuesta del agente.");
      setMessages((current) => [...current, { role: "assistant", content: data.message! }]);
      setGarmentAnalysis(data.garmentAnalysis ?? garmentAnalysis); setTemporaryCloset(data.temporaryCloset ?? temporaryCloset); setDebug(data.debug ?? null); setAttachments([]);
      if (data.debug) setSessionMetrics((current) => ({ modelCalls: current.modelCalls + data.debug!.modelCalls, toolCalls: current.toolCalls + data.debug!.toolCalls, inputTokens: current.inputTokens + data.debug!.usage.inputTokens, outputTokens: current.outputTokens + data.debug!.usage.outputTokens, totalTokens: current.totalTokens + data.debug!.usage.totalTokens, estimatedCostUsd: current.estimatedCostUsd + data.debug!.estimatedCostUsd, durationMs: current.durationMs + data.debug!.durationMs }));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo contactar al agente."); }
    finally { setThinking(false); }
  }

  function reset() { setMessages([welcome]); setDraft(""); setAttachments([]); setGarmentAnalysis(null); setTemporaryCloset(null); setError(""); setDebug(null); setSessionMetrics(emptyMetrics); setCommercial({ purchaseIntent: false, selectedProduct: "", saleMade: false }); }

  return <div className="agent-page"><header className="agent-header"><div><span className="eyebrow">BLOQUE 2C · PRUEBA INTERNA</span><h1>Agente vendedor</h1><p>Asesora conectada al catálogo real con análisis temporal de prendas.</p></div><button className="secondary-button" onClick={reset}>Nueva conversación</button></header>
    {multiEnabled && <div className="multi-mode"><div><strong>Analizar varias prendas</strong><small>Mini-closet temporal de 2 a 4 imágenes.</small></div><button className={multiMode ? "active" : ""} onClick={toggleMultiMode}>{multiMode ? "Activo" : "Activar"}</button></div>}
    <div className="agent-layout"><section className="chat-panel"><div className="chat-history" aria-live="polite">{messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.imagePreviews && <div className="message-images">{message.imagePreviews.map((src, imageIndex) => <Image key={imageIndex} src={src} width={180} height={210} unoptimized alt={`Prenda adjunta ${imageIndex + 1}`}/>)}</div>}<small>{message.role === "assistant" ? "Columpio Mujer" : "Tú"}</small><p>{message.content}</p></article>)}{thinking && <article className="chat-message assistant thinking"><small>Columpio Mujer</small><p>{attachments.length ? `Analizando ${attachments.length} prenda${attachments.length > 1 ? "s" : ""} y consultando el catálogo…` : "Consultando el catálogo…"}</p></article>}</div>
      {error && <div className="form-error">{error}</div>}{attachments.length > 0 && <div className="multi-preview">{attachments.map((item, index) => <div className="image-preview" key={item.id}><b>{index + 1}</b><Image src={item.dataUrl} width={62} height={62} unoptimized alt={`Vista previa ${index + 1}`}/><div><strong>{item.name}</strong><small>No se guardará.</small></div><button type="button" onClick={() => removeAttachment(item.id)} aria-label={`Eliminar imagen ${index + 1}`}>×</button></div>)}</div>}
      <form className="chat-composer" onSubmit={submit}><label htmlFor="agent-message">Mensaje</label><textarea id="agent-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={multiMode ? "Ej. ¿Qué única pieza potenciaría estas prendas?" : "Ej. Quiero usar más esta blusa"} maxLength={2000} disabled={thinking}/><div className="composer-actions"><input ref={fileInput} type="file" multiple={multiMode} accept="image/jpeg,image/png,image/webp" onChange={selectImages} hidden/><button className="attach-button" type="button" onClick={() => fileInput.current?.click()} disabled={thinking}>{multiMode ? `Adjuntar prendas (${attachments.length}/4)` : "Adjuntar foto"}</button><button className="primary-button" disabled={thinking || (!draft.trim() && !attachments.length)}>Enviar <Icon name="arrow" size={17}/></button></div></form></section>
      {process.env.NODE_ENV === "development" && <aside className="agent-debug"><span className="eyebrow">DEBUG · SOLO DESARROLLO</span><h2>Actividad segura</h2>{!debug ? <p>Aún no hay llamadas.</p> : <><div className="debug-summary"><b>Sesión {debug.experience}</b><span>Imágenes: {debug.imageCount} · Prendas: {debug.temporaryCloset?.length ?? (debug.garmentAnalysis ? 1 : 0)}</span><span>{sessionMetrics.modelCalls} llamadas · {sessionMetrics.toolCalls} tools</span><span>{sessionMetrics.inputTokens} entrada · {sessionMetrics.outputTokens} salida</span><span>Costo estimado: US$ {sessionMetrics.estimatedCostUsd.toFixed(5)}</span><span>Duración acumulada: {(sessionMetrics.durationMs / 1000).toFixed(1)} s</span></div><small>INTENCIÓN</small><p>{debug.intent}</p><small>PRENDAS RECONOCIDAS</small><code>{JSON.stringify(debug.temporaryCloset ?? debug.garmentAnalysis, null, 2)}</code>{debug.searches.map((call, index) => <div className="debug-call" key={index}><strong>{call.tool}</strong><code>{JSON.stringify(call.filters, null, 2)}</code><span>{call.resultCount} resultados</span></div>)}<small>PRODUCTOS RECOMENDADOS</small><p>{debug.recommendedProducts.length ? debug.recommendedProducts.map((product) => `${product.name} (${product.sku})`).join(", ") : "Ninguno"}</p><div className="commercial-metrics"><label><input type="checkbox" checked={commercial.purchaseIntent} onChange={(event) => setCommercial({ ...commercial, purchaseIntent: event.target.checked })}/> Intención de compra</label><input placeholder="Producto seleccionado (opcional)" value={commercial.selectedProduct} onChange={(event) => setCommercial({ ...commercial, selectedProduct: event.target.value })}/><label><input type="checkbox" checked={commercial.saleMade} onChange={(event) => setCommercial({ ...commercial, saleMade: event.target.checked })}/> Venta realizada</label></div></>}</aside>}
    </div></div>;
}
