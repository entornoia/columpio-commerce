import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { catalogToolDefinition, executeCatalogTool } from "@/lib/agent/catalog-tool";
import { MAX_CONVERSATION_MESSAGES, MAX_TOOL_ROUNDS, SELLER_AGENT_MODEL } from "@/lib/agent/config";
import { SELLER_AGENT_INSTRUCTIONS } from "@/lib/agent/prompt";
import { analyzeGarmentImage, isGarmentAnalysisUnclear, validateGarmentAnalysis, validateGarmentImage, type GarmentAnalysis } from "@/lib/agent/garment-analysis";
import type { CatalogSearchResult } from "@/lib/catalog-search";

type ChatMessage = { role: "user" | "assistant"; content: string };
type DebugCall = { intent: string; tool: "search_catalog"; filters: unknown; resultCount: number };
type Usage = { inputTokens: number; outputTokens: number; totalTokens: number };

function describeIntent(filters: Record<string, unknown>) {
  const details = Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => `${key}=${String(value)}`);
  return details.length ? `Buscar productos con ${details.join(", ")}` : "Explorar productos activos del catálogo";
}

function validateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("La conversación está vacía.");
  return value.slice(-MAX_CONVERSATION_MESSAGES).map((message) => {
    if (!message || typeof message !== "object") throw new Error("Mensaje inválido.");
    const item = message as Record<string, unknown>;
    if ((item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string" || !item.content.trim() || item.content.length > 2_000) throw new Error("Mensaje inválido.");
    return { role: item.role, content: item.content.trim() };
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (authError || !userData.user || claimsData?.claims?.role !== "authenticated") return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Falta configurar OPENAI_API_KEY en .env.local." }, { status: 503 });

  try {
    const body = await request.json() as { messages?: unknown; image?: unknown; garmentAnalysis?: unknown };
    const messages = validateMessages(body.messages);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let garmentAnalysis: GarmentAnalysis | null = body.garmentAnalysis ? validateGarmentAnalysis(body.garmentAnalysis) : null;
    const usage: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let modelCalls = 0;
    const addUsage = (value: OpenAI.Responses.ResponseUsage | undefined) => {
      modelCalls += 1;
      usage.inputTokens += value?.input_tokens ?? 0; usage.outputTokens += value?.output_tokens ?? 0; usage.totalTokens += value?.total_tokens ?? 0;
    };
    if (body.image) {
      const analyzed = await analyzeGarmentImage(openai, validateGarmentImage(body.image));
      garmentAnalysis = analyzed.analysis;
      addUsage(analyzed.usage);
      if (isGarmentAnalysisUnclear(garmentAnalysis)) {
        const message = "La imagen está demasiado borrosa para identificar la prenda con seguridad. ¿Podrías subir una foto más clara o decirme si es una blusa, un top, un pantalón u otra prenda?";
        return NextResponse.json({ message, garmentAnalysis, ...(process.env.NODE_ENV === "development" ? { debug: { imageReceived: true, garmentAnalysis, intent: messages.at(-1)?.content, searches: [], recommendedProducts: [], modelCalls, usage } } : {}) });
      }
    }
    let input: OpenAI.Responses.ResponseInput = [
      ...(garmentAnalysis ? [{ role: "developer" as const, content: `CONTEXTO VISUAL DE PRENDA (interpretación, no inventario):\n${JSON.stringify(garmentAnalysis)}` }] : []),
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    const debug: DebugCall[] = [];
    const candidates = new Map<string, CatalogSearchResult>();

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await openai.responses.create({
        model: SELLER_AGENT_MODEL,
        instructions: SELLER_AGENT_INSTRUCTIONS,
        input,
        tools: [catalogToolDefinition],
        tool_choice: "auto",
        parallel_tool_calls: false,
        store: false,
        max_output_tokens: 700,
      });
      addUsage(response.usage);
      const calls = response.output.filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        const recommendedProducts = [...candidates.values()].filter((product) => response.output_text.toLocaleLowerCase("es-CL").includes(product.name.toLocaleLowerCase("es-CL"))).map((product) => ({ name: product.name, sku: product.sku }));
        return NextResponse.json({
          message: response.output_text || "No pude preparar una respuesta en este momento.",
          garmentAnalysis,
          ...(process.env.NODE_ENV === "development" ? { debug: { imageReceived: Boolean(body.image), garmentAnalysis, intent: messages.at(-1)?.content, searches: debug, recommendedProducts, modelCalls, usage } } : {}),
        });
      }

      input = [...input, ...calls.map((call) => ({
        type: "function_call" as const,
        call_id: call.call_id,
        name: call.name,
        arguments: call.arguments,
      }))];
      for (const call of calls) {
        if (call.name !== "search_catalog") throw new Error("Herramienta no permitida.");
        const toolResult = await executeCatalogTool(supabase, JSON.parse(call.arguments));
        for (const product of toolResult.results) {
          if (product.compatibleVariants.some((variant) => variant.stock > 0)) candidates.set(product.id, product);
        }
        debug.push({ intent: describeIntent(toolResult.filters as Record<string, unknown>), tool: "search_catalog", filters: toolResult.filters, resultCount: toolResult.resultCount });
        input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(toolResult) });
      }
    }
    return NextResponse.json({ error: "El agente excedió el límite seguro de búsquedas." }, { status: 422 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado del agente.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
