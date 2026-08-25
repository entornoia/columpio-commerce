"use client";

import { ChangeEvent, FormEvent, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons";
import type { GarmentAnalysis } from "@/lib/agent/garment-analysis";
import { ALLOWED_GARMENT_IMAGE_TYPES, MAX_GARMENT_IMAGE_BYTES } from "@/lib/agent/config";

type Message = { role: "user" | "assistant"; content: string; imagePreview?: string };
type DebugSearch = { intent: string; tool: string; filters: Record<string, unknown>; resultCount: number };
type AgentDebug = { imageReceived: boolean; garmentAnalysis: GarmentAnalysis | null; intent?: string; searches: DebugSearch[]; recommendedProducts: { name: string; sku: string }[]; modelCalls: number; usage: { inputTokens: number; outputTokens: number; totalTokens: number } };

const welcome: Message = { role: "assistant", content: "Hola, soy la asesora interna de Columpio Mujer. Puedes contarme qué buscas o adjuntar una foto de una prenda que quieras combinar." };

export default function AgentTestPage() {
  const [messages, setMessages] = useState<Message[]>([welcome]);
  const [draft, setDraft] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [garmentAnalysis, setGarmentAnalysis] = useState<GarmentAnalysis | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState<AgentDebug | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!(ALLOWED_GARMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) return setError("Solo se aceptan imágenes JPEG, PNG o WebP.");
    if (file.size > MAX_GARMENT_IMAGE_BYTES) return setError("La imagen debe pesar como máximo 5 MB.");
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result)); setImageName(file.name); setError(""); };
    reader.onerror = () => setError("No se pudo leer la imagen.");
    reader.readAsDataURL(file);
  }

  function removeImage() { setImage(null); setImageName(""); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if ((!content && !image) || thinking) return;
    const userContent = content || "¿Con qué combinarías esta prenda?";
    const currentImage = image;
    const nextMessages = [...messages, { role: "user" as const, content: userContent, ...(currentImage ? { imagePreview: currentImage } : {}) }];
    setMessages(nextMessages); setDraft(""); setThinking(true); setError("");
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })), image: currentImage, garmentAnalysis }) });
      const data = await response.json() as { message?: string; error?: string; garmentAnalysis?: GarmentAnalysis | null; debug?: AgentDebug };
      if (!response.ok || !data.message) throw new Error(data.error || "No se recibió respuesta del agente.");
      setMessages((current) => [...current, { role: "assistant", content: data.message! }]);
      setGarmentAnalysis(data.garmentAnalysis ?? garmentAnalysis);
      setDebug(data.debug ?? null);
      removeImage();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo contactar al agente."); }
    finally { setThinking(false); }
  }

  function reset() { setMessages([welcome]); setDraft(""); removeImage(); setGarmentAnalysis(null); setError(""); setDebug(null); }

  return <div className="agent-page"><header className="agent-header"><div><span className="eyebrow">BLOQUE 2B · PRUEBA INTERNA</span><h1>Agente vendedor</h1><p>Asesora conectada al catálogo real, ahora con análisis temporal de prendas.</p></div><button className="secondary-button" onClick={reset}>Nueva conversación</button></header>
    <div className="agent-layout"><section className="chat-panel"><div className="chat-history" aria-live="polite">{messages.map((message, index) => <article className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>{message.imagePreview && <Image src={message.imagePreview} width={260} height={300} unoptimized alt="Prenda adjunta por la clienta"/>}<small>{message.role === "assistant" ? "Columpio Mujer" : "Tú"}</small><p>{message.content}</p></article>)}{thinking && <article className="chat-message assistant thinking"><small>Columpio Mujer</small><p>{image ? "Analizando la prenda y consultando el catálogo…" : "Consultando el catálogo…"}</p></article>}</div>{error && <div className="form-error">{error}</div>}{image && <div className="image-preview"><Image src={image} width={62} height={62} unoptimized alt="Vista previa de la prenda"/><div><strong>{imageName}</strong><small>La foto se procesará temporalmente y no se guardará.</small></div><button type="button" onClick={removeImage} aria-label="Eliminar imagen">×</button></div>}<form className="chat-composer" onSubmit={submit}><label htmlFor="agent-message">Mensaje</label><textarea id="agent-message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ej. Quiero usar más esta blusa" maxLength={2000} disabled={thinking}/><div className="composer-actions"><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={selectImage} hidden/><button className="attach-button" type="button" onClick={() => fileInput.current?.click()} disabled={thinking}>Adjuntar foto</button><button className="primary-button" disabled={thinking || (!draft.trim() && !image)}>Enviar <Icon name="arrow" size={17}/></button></div></form></section>
      {process.env.NODE_ENV === "development" && <aside className="agent-debug"><span className="eyebrow">DEBUG · SOLO DESARROLLO</span><h2>Actividad segura</h2>{!debug ? <p>Aún no hay llamadas.</p> : <><div className="debug-summary"><b>Imagen recibida: {debug.imageReceived ? "sí" : "no"}</b><span>{debug.modelCalls} llamadas · {debug.usage.totalTokens} tokens</span></div><small>INTENCIÓN</small><p>{debug.intent}</p><small>ATRIBUTOS DETECTADOS</small><code>{JSON.stringify(debug.garmentAnalysis, null, 2)}</code>{debug.searches.map((call, index) => <div className="debug-call" key={index}><strong>{call.tool}</strong><code>{JSON.stringify(call.filters, null, 2)}</code><span>{call.resultCount} resultados</span></div>)}<small>PRODUCTOS RECOMENDADOS</small><p>{debug.recommendedProducts.length ? debug.recommendedProducts.map((product) => `${product.name} (${product.sku})`).join(", ") : "Ninguno"}</p></>}</aside>}
    </div>
  </div>;
}
