import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogToolDefinition, executeCatalogTool } from "./catalog-tool";
import { MAX_CONVERSATION_MESSAGES, MAX_TOOL_ROUNDS, MAX_TEMPORARY_CLOSET_SIZE, multiGarmentStylingEnabled, SELLER_AGENT_MODEL } from "./config";
import { SELLER_AGENT_INSTRUCTIONS } from "./prompt";
import { analyzeGarmentImage, analyzeGarmentImages, isGarmentAnalysisUnclear, validateGarmentAnalysis, validateGarmentImage, validateTemporaryCloset, type GarmentAnalysis, type TemporaryGarment } from "./garment-analysis";
import { estimateTokenCostUsd, type TokenUsage } from "./cost";
import type { CatalogSearchResult } from "../catalog-search";
import { commerceToolDefinitions } from "../commerce/tool-definitions";
import { executeCommerceTool, isCommerceToolName } from "../commerce/tools";
import type { InstagramCommerceContext } from "../commerce/types";
import { formatCommerceResponse } from "../commerce/response-formatter";

export type AgentChatMessage = { role: "user" | "assistant"; content: string };
type DebugCall = { intent: string; tool: "search_catalog"; filters: unknown; resultCount: number };
type CommerceDebugCall = { tool: "add_to_cart" | "view_cart" | "remove_from_cart" | "set_cart_quantity" | "create_order"; status: string };

export type SellerAgentInput = {
  messages: unknown;
  image?: unknown;
  images?: unknown;
  garmentAnalysis?: unknown;
  temporaryCloset?: unknown;
};

export type SellerAgentResult = {
  message: string;
  garmentAnalysis: GarmentAnalysis | null;
  temporaryCloset: TemporaryGarment[] | null;
  debug: {
    experience: "texto" | "2B" | "2C";
    imageCount: number;
    imageReceived: boolean;
    garmentAnalysis: GarmentAnalysis | null;
    temporaryCloset: TemporaryGarment[] | null;
    intent: string | undefined;
    searches: DebugCall[];
    commerceOperations: CommerceDebugCall[];
    recommendedProducts: { name: string; sku: string }[];
    modelCalls: number;
    toolCalls: number;
    usage: TokenUsage;
    estimatedCostUsd: number;
    costFullyEstimated: boolean;
    durationMs: number;
  };
};

function describeIntent(filters: Record<string, unknown>) {
  const details = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => `${key}=${String(value)}`);
  return details.length ? `Buscar productos con ${details.join(", ")}` : "Explorar productos activos del catálogo";
}

export function validateAgentMessages(value: unknown): AgentChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("La conversación está vacía.");
  return value.slice(-MAX_CONVERSATION_MESSAGES).map((message) => {
    if (!message || typeof message !== "object") throw new Error("Mensaje inválido.");
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 2_000) throw new Error("Mensaje inválido.");
    return { role: item.role, content: item.content.trim() };
  });
}

export async function runSellerAgent(supabase: SupabaseClient, body: SellerAgentInput, commerce?: Omit<InstagramCommerceContext, "supabase">): Promise<SellerAgentResult> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Falta configurar OPENAI_API_KEY en .env.local.");
  const startedAt = Date.now();
  const messages = validateAgentMessages(body.messages);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let garmentAnalysis: GarmentAnalysis | null = body.garmentAnalysis ? validateGarmentAnalysis(body.garmentAnalysis) : null;
  let temporaryCloset: TemporaryGarment[] | null = body.temporaryCloset ? validateTemporaryCloset(body.temporaryCloset) : null;
  if (temporaryCloset && !multiGarmentStylingEnabled()) throw new Error("El análisis de varias prendas está desactivado.");
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let modelCalls = 0;
  let estimatedCostUsd = 0;
  let costFullyEstimated = true;
  const addUsage = (value: OpenAI.Responses.ResponseUsage | undefined, model: string) => {
    modelCalls += 1;
    const current = { inputTokens: value?.input_tokens ?? 0, outputTokens: value?.output_tokens ?? 0, totalTokens: value?.total_tokens ?? 0 };
    usage.inputTokens += current.inputTokens; usage.outputTokens += current.outputTokens; usage.totalTokens += current.totalTokens;
    const cost = estimateTokenCostUsd(model, current); if (cost === null) costFullyEstimated = false; else estimatedCostUsd += cost;
  };

  if (body.images !== undefined) {
    if (!multiGarmentStylingEnabled()) throw new Error("El análisis de varias prendas está desactivado.");
    if (!Array.isArray(body.images) || body.images.length < 2 || body.images.length > MAX_TEMPORARY_CLOSET_SIZE) throw new Error("Puedes analizar entre 2 y 4 prendas por consulta.");
    const analyzed = await analyzeGarmentImages(openai, body.images.map(validateGarmentImage));
    temporaryCloset = analyzed.garments;
    addUsage(analyzed.usage, analyzed.model);
  }
  if (body.image) {
    const analyzed = await analyzeGarmentImage(openai, validateGarmentImage(body.image));
    garmentAnalysis = analyzed.analysis;
    addUsage(analyzed.usage, analyzed.model);
    if (isGarmentAnalysisUnclear(garmentAnalysis)) {
      const message = "La imagen está demasiado borrosa para identificar la prenda con seguridad. ¿Podrías subir una foto más clara o decirme si es una blusa, un top, un pantalón u otra prenda?";
      return { message, garmentAnalysis, temporaryCloset, debug: buildDebug([], [], [], messages, body, garmentAnalysis, temporaryCloset, modelCalls, usage, estimatedCostUsd, costFullyEstimated, startedAt) };
    }
  }

  let input: OpenAI.Responses.ResponseInput = [
    ...(temporaryCloset ? [{ role: "developer" as const, content: `MINI-CLOSET TEMPORAL (interpretaciones visuales, no inventario):\n${JSON.stringify(temporaryCloset)}\nPrioriza una sola compra de alto impacto que combine con la mayor cantidad de estas prendas. Puedes dar hasta dos alternativas. Cada producto debe provenir de search_catalog con active=true e inStock=true. Indica de forma prudente con cuántas prendas combina y por qué. Si alguna prenda tiene incertidumbre, reconócelo y continúa con las identificables.` }] : []),
    ...(garmentAnalysis ? [{ role: "developer" as const, content: `CONTEXTO VISUAL DE PRENDA (interpretación, no inventario):\n${JSON.stringify(garmentAnalysis)}` }] : []),
    ...messages.map((message) => ({ role: message.role, content: message.content })),
  ];
  const searches: DebugCall[] = [];
  const commerceOperations: CommerceDebugCall[] = [];
  const candidates = new Map<string, CatalogSearchResult>();
  const maxRounds = temporaryCloset ? 4 : MAX_TOOL_ROUNDS;

  for (let round = 0; round < maxRounds; round += 1) {
    const response = await openai.responses.create({ model: SELLER_AGENT_MODEL, instructions: SELLER_AGENT_INSTRUCTIONS, input, tools: commerce ? [catalogToolDefinition, ...commerceToolDefinitions] : [catalogToolDefinition], tool_choice: "auto", parallel_tool_calls: false, store: false, max_output_tokens: 700 });
    addUsage(response.usage, SELLER_AGENT_MODEL);
    const calls = response.output.filter((item) => item.type === "function_call");
    if (calls.length === 0) {
      const recommendedProducts = [...candidates.values()].filter((product) => response.output_text.toLocaleLowerCase("es-CL").includes(product.name.toLocaleLowerCase("es-CL"))).map((product) => ({ name: product.name, sku: product.sku }));
      return { message: response.output_text || "No pude preparar una respuesta en este momento.", garmentAnalysis, temporaryCloset, debug: buildDebug(searches, commerceOperations, recommendedProducts, messages, body, garmentAnalysis, temporaryCloset, modelCalls, usage, estimatedCostUsd, costFullyEstimated, startedAt) };
    }
    input = [...input, ...calls.map((call) => ({ type: "function_call" as const, call_id: call.call_id, name: call.name, arguments: call.arguments }))];
    for (const call of calls) {
      const parsedArguments = JSON.parse(call.arguments);
      if (call.name === "search_catalog") {
        const toolResult = await executeCatalogTool(supabase, parsedArguments);
        for (const product of toolResult.results) if (product.compatibleVariants.some((variant) => variant.stock > 0)) candidates.set(product.id, product);
        searches.push({ intent: describeIntent(toolResult.filters as Record<string, unknown>), tool: "search_catalog", filters: toolResult.filters, resultCount: toolResult.resultCount });
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(toolResult) });
      } else if (commerce && isCommerceToolName(call.name)) {
        const toolResult = await executeCommerceTool({ ...commerce, supabase }, call.name, parsedArguments);
        commerceOperations.push({ tool: call.name, status: toolResult.status });
        return { message: formatCommerceResponse(call.name, toolResult, parsedArguments), garmentAnalysis, temporaryCloset, debug: buildDebug(searches, commerceOperations, [], messages, body, garmentAnalysis, temporaryCloset, modelCalls, usage, estimatedCostUsd, costFullyEstimated, startedAt) };
      } else throw new Error("Herramienta no permitida.");
    }
  }
  throw new Error("El agente excedió el límite seguro de búsquedas.");
}

function buildDebug(searches: DebugCall[], commerceOperations: CommerceDebugCall[], recommendedProducts: { name: string; sku: string }[], messages: AgentChatMessage[], body: SellerAgentInput, garmentAnalysis: GarmentAnalysis | null, temporaryCloset: TemporaryGarment[] | null, modelCalls: number, usage: TokenUsage, estimatedCostUsd: number, costFullyEstimated: boolean, startedAt: number): SellerAgentResult["debug"] {
  return { experience: temporaryCloset ? "2C" : garmentAnalysis ? "2B" : "texto", imageCount: Array.isArray(body.images) ? body.images.length : body.image ? 1 : 0, imageReceived: Boolean(body.image || body.images), garmentAnalysis, temporaryCloset, intent: messages.at(-1)?.content, searches, commerceOperations, recommendedProducts, modelCalls, toolCalls: searches.length + commerceOperations.length, usage, estimatedCostUsd, costFullyEstimated, durationMs: Date.now() - startedAt };
}
