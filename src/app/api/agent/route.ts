import { NextResponse } from "next/server";
import { runSellerAgent, type SellerAgentInput } from "@/lib/agent/runner";
import { multiGarmentStylingEnabled } from "@/lib/agent/config";
import { createClient } from "@/lib/supabase/server";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const { data: claimsData } = await supabase.auth.getClaims();
  return { supabase, authenticated: !authError && Boolean(userData.user) && claimsData?.claims?.role === "authenticated" };
}

export async function GET() {
  const { authenticated } = await authenticatedClient();
  if (!authenticated) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  return NextResponse.json({ multiGarmentStyling: multiGarmentStylingEnabled() });
}

export async function POST(request: Request) {
  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    const result = await runSellerAgent(supabase, await request.json() as SellerAgentInput);
    const { debug, ...publicResult } = result;
    return NextResponse.json({ ...publicResult, ...(process.env.NODE_ENV === "development" ? { debug } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado del agente.";
    const status = message.includes("OPENAI_API_KEY") ? 503 : message.includes("límite seguro") ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
