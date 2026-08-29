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
  // BLOQUE 4C: solo acusa recepción. La consulta y actualización del pago pertenecen a 4D.
  return new Response("OK", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
