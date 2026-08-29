import OpenAI from "openai";
import { INTENT_ROUTER_MODEL } from "../../agent/config.ts";
import type { InstagramIntent, InstagramIntentState } from "./conversation-repository";
import { classifyIntentByRules, type IntentClassification } from "./intent-rules.ts";
import type { IncomingCommerceMessage } from "./types";

const intents: InstagramIntent[] = ["sales", "after_sales", "exchange_return", "general_info", "business_proposal", "social_reaction", "human_request", "unknown"];
const fallback = (reason: string): IntentClassification => ({ intent: "unknown", confidence: 0, reason, source: "fallback" });

export type AmbiguousIntentClassifier = (message: IncomingCommerceMessage, state: InstagramIntentState) => Promise<unknown>;

function validate(value: unknown): IntentClassification {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback("Clasificación inválida");
  const record = value as Record<string, unknown>;
  if (typeof record.intent !== "string" || !intents.includes(record.intent as InstagramIntent) || typeof record.confidence !== "number" || !Number.isFinite(record.confidence) || typeof record.reason !== "string") return fallback("Clasificación inválida");
  if (record.confidence < 0.75) return fallback("Confianza insuficiente");
  return { intent: record.intent as InstagramIntent, confidence: Math.min(record.confidence, 1), reason: record.reason.slice(0, 160), source: "llm" };
}

export async function classifyAmbiguousIntent(message: IncomingCommerceMessage, state: InstagramIntentState) {
  if (!process.env.OPENAI_API_KEY) return fallback("Clasificador no configurado");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await openai.responses.create({
      model: INTENT_ROUTER_MODEL,
      instructions: "Clasifica la intención principal de un DM de Instagram para una tienda de ropa. No respondas al cliente, no inventes políticas ni datos y no ejecutes acciones. human_request tiene prioridad. Una reacción pura es social_reaction; una reacción con pregunta comercial es sales. En reason usa una categoría breve: no copies el mensaje ni incluyas nombres, identificadores u otros datos personales.",
      input: JSON.stringify({ text: message.text, hasImage: Boolean(message.imageUrl), hasStoryContext: Boolean(message.metadata?.storyId || message.metadata?.storyUrl), previousIntent: state.lastIntent }),
      tools: [], store: false, max_output_tokens: 120,
      text: { format: { type: "json_schema", name: "instagram_intent", strict: true, schema: { type: "object", additionalProperties: false, properties: { intent: { type: "string", enum: intents }, confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" } }, required: ["intent", "confidence", "reason"] } }, verbosity: "low" },
    }, { signal: controller.signal });
    return JSON.parse(response.output_text);
  } finally { clearTimeout(timeout); }
}

export async function routeInstagramIntent(message: IncomingCommerceMessage, state: InstagramIntentState, classifier: AmbiguousIntentClassifier = classifyAmbiguousIntent): Promise<IntentClassification> {
  const deterministic = classifyIntentByRules(message, state);
  if (deterministic) return deterministic;
  try { return validate(await classifier(message, state)); } catch { return fallback("Clasificador no disponible"); }
}
