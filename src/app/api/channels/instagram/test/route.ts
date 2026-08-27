import { createAdminClient } from "@/lib/supabase/admin";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { processInstagramPayload } from "@/lib/channels/instagram/processor";
import { instagramEvents } from "@/lib/channels/instagram/stores";
import { validateGarmentImage } from "@/lib/agent/garment-analysis";

export async function GET() {
  const { authorized } = await getAdministrativeSession();
  if (!authorized) return Response.json({ error: "No autorizado." }, { status: 401 });
  return Response.json({ events: instagramEvents.recent() });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Disponible solo en desarrollo." }, { status: 404 });
  const { authorized } = await getAdministrativeSession();
  if (!authorized) return Response.json({ error: "No autorizado." }, { status: 401 });
  try {
    const body = await request.json() as { payload?: unknown; fixtureImage?: unknown };
    const payload = body.payload ?? body;
    const fixtureImage = body.fixtureImage ? validateGarmentImage(body.fixtureImage).dataUrl : null;
    const sent: { recipientId: string; text: string }[] = [];
    const result = await processInstagramPayload(payload, process.env.META_INSTAGRAM_ACCOUNT_ID, { supabase: createAdminClient(), sendText: async (recipientId, text) => { sent.push({ recipientId, text }); }, fetchImage: async () => {
      if (!fixtureImage) throw new Error("Adjunta una imagen de fixture válida para probar el flujo 2B.");
      return fixtureImage;
    } });
    return Response.json({ ...result, sent });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error de prueba." }, { status: 500 });
  }
}
