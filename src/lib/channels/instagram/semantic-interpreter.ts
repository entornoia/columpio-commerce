import OpenAI from "openai";
import { INTENT_ROUTER_MODEL } from "../../agent/config.ts";
import { semanticCommerceJsonSchema, validateSemanticCommerceInterpretation, type SemanticCommerceInterpretation } from "./semantic-schema.ts";

export type SemanticCommerceContext = {
  message: string;
  focus: { name: string; category: string | null; color: string | null; size: string | null } | null;
  /** Campos deprecated aceptados solo por el orquestador transaccional inactivo. */
  hasSelection?: boolean;
  selectedKinds?: number;
  hasOrder?: boolean;
  checkoutStage?: "none" | "needs_email" | "creating" | "ready" | "uncertain" | "failed";
  conversationState: string;
};

export type SemanticInterpreter = (context: SemanticCommerceContext) => Promise<SemanticCommerceInterpretation | null>;

export async function interpretSemanticCommerce(context: SemanticCommerceContext): Promise<SemanticCommerceInterpretation | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await openai.responses.create({
      model: INTENT_ROUTER_MODEL,
      instructions: `Interpreta un único mensaje de Instagram para una asesora de tienda. No respondas y no ejecutes tools. Solo puedes buscar catálogo, consultar atributos, recomendar productos reales, detectar intención de compra para dirigir a la web, detectar rutas sensibles o pedir aclaración. No inventes ni devuelvas IDs, SKU, precios, stock, cantidades, emails, pedidos, URLs, tokens ni estados de pago. Para pronombres usa focus solo si fue suministrado. Una recomendación nunca selecciona, agrega ni compra. Frases como quiero comprar, la quiero, me la llevo, cómo compro, dónde compro, quiero esa o mándame el link son purchase_cta.`,
      input: JSON.stringify(context), tools: [], store: false, max_output_tokens: 220,
      text: { format: { type: "json_schema", name: "semantic_commerce", strict: true, schema: semanticCommerceJsonSchema }, verbosity: "low" },
    }, { signal: controller.signal });
    return validateSemanticCommerceInterpretation(JSON.parse(response.output_text));
  } catch { return null; } finally { clearTimeout(timeout); }
}

export function semanticCommerceOrchestratorEnabled() {
  return process.env.ENABLE_SEMANTIC_COMMERCE_ORCHESTRATOR === "true";
}

export function instagramAdvisorModeEnabled() {
  return process.env.INSTAGRAM_COMMERCE_MODE === "advisor";
}
