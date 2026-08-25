import { createClient } from "@/lib/supabase/server";
import { processInstagramPayload } from "@/lib/channels/instagram/processor";
import { instagramEvents } from "@/lib/channels/instagram/stores";
import { validateGarmentImage } from "@/lib/agent/garment-analysis";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, authenticated: !error && Boolean(data.user) };
}

export async function GET() {
  const { authenticated } = await authenticatedClient();
  if (!authenticated) return Response.json({ error: "No autorizado." }, { status: 401 });
  return Response.json({ events: instagramEvents.recent() });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return Response.json({ error: "Disponible solo en desarrollo." }, { status: 404 });
  const { supabase, authenticated } = await authenticatedClient();
  if (!authenticated) return Response.json({ error: "No autorizado." }, { status: 401 });
  try {
    const body = await request.json() as { payload?: unknown; fixtureImage?: unknown };
    const payload = body.payload ?? body;
    const fixtureImage = body.fixtureImage ? validateGarmentImage(body.fixtureImage).dataUrl : null;
    const sent: { recipientId: string; text: string }[] = [];
    const result = await processInstagramPayload(payload, process.env.META_INSTAGRAM_ACCOUNT_ID, { supabase, sendText: async (recipientId, text) => { sent.push({ recipientId, text }); }, fetchImage: async () => {
      if (!fixtureImage) throw new Error("Adjunta una imagen de fixture válida para probar el flujo 2B.");
      return fixtureImage;
    } });
    return Response.json({ ...result, sent });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error de prueba." }, { status: 500 });
  }
}
