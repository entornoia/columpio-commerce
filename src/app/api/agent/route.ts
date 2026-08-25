import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { catalogToolDefinition, executeCatalogTool } from "@/lib/agent/catalog-tool";
import { MAX_CONVERSATION_MESSAGES, MAX_TOOL_ROUNDS, SELLER_AGENT_MODEL } from "@/lib/agent/config";
import { SELLER_AGENT_INSTRUCTIONS } from "@/lib/agent/prompt";

type ChatMessage = { role: "user" | "assistant"; content: string };
type DebugCall = { intent: string; tool: "search_catalog"; filters: unknown; resultCount: number };

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
    const body = await request.json() as { messages?: unknown };
    const messages = validateMessages(body.messages);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let input: OpenAI.Responses.ResponseInput = messages.map((message) => ({ role: message.role, content: message.content }));
    const debug: DebugCall[] = [];

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
      const calls = response.output.filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        return NextResponse.json({
          message: response.output_text || "No pude preparar una respuesta en este momento.",
          ...(process.env.NODE_ENV === "development" ? { debug } : {}),
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
