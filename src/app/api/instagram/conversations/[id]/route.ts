import { NextResponse } from "next/server";
import { setInstagramAutomationMode, type InstagramAutomationMode } from "@/lib/channels/instagram/conversation-repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modes = new Set<InstagramAutomationMode>(["agent", "temporary_human", "human_only"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { authorized } = await getAdministrativeSession();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Conversación inválida." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const mode = body && typeof body === "object" && !Array.isArray(body) ? (body as { mode?: unknown }).mode : undefined;
  if (typeof mode !== "string" || !modes.has(mode as InstagramAutomationMode) || !body || Object.keys(body).some((key) => key !== "mode")) {
    return NextResponse.json({ error: "Modo inválido. Usa agent, temporary_human o human_only." }, { status: 400 });
  }

  try {
    const conversation = await setInstagramAutomationMode(createAdminClient(), id, mode as InstagramAutomationMode);
    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cambiar el estado." }, { status: 500 });
  }
}
