import { NextResponse } from "next/server";
import { listInstagramConversations } from "@/lib/channels/instagram/conversation-repository";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";

export async function GET() {
  const { authorized } = await getAdministrativeSession();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  try {
    return NextResponse.json({ conversations: await listInstagramConversations(createAdminClient()) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las conversaciones." }, { status: 500 });
  }
}
