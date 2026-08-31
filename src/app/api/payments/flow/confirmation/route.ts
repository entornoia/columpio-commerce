import { confirmWebFlowToken } from "@/lib/storefront/payment-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return Response.json({ error: "Content-Type inválido." }, { status: 415 });
  }
  const token = (await request.formData()).get("token");
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return Response.json({ error: "Token inválido." }, { status: 400 });
  }
  try {
    // La autoridad es getStatus de Flow; el token recibido nunca confirma por sí solo.
    await confirmWebFlowToken(token);
    return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch {
    return new Response("RETRY", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
