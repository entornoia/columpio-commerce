import { NextResponse } from "next/server";
import { setHandoffCaseStatus } from "@/lib/channels/instagram/handoff-cases";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set(["take", "resolve"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { authorized } = await getAdministrativeSession();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  if (!uuidPattern.test(id)) return NextResponse.json({ error: "Caso inválido." }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  const action = body && typeof body === "object" && !Array.isArray(body) ? (body as { action?: unknown }).action : undefined;
  if (typeof action !== "string" || !actions.has(action) || Object.keys(body as object).some((key) => key !== "action")) {
    return NextResponse.json({ error: "Acción inválida. Usa take o resolve." }, { status: 400 });
  }

  try {
    return NextResponse.json({ handoffCase: await setHandoffCaseStatus(createAdminClient(), id, action as "take" | "resolve") });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el caso." }, { status: 409 });
  }
}
