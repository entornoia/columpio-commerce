import { NextResponse } from "next/server";
import { flowPublicUrl } from "@/lib/payments/flow";

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
  // El retorno del navegador es informativo; no muta pedido, pago ni stock.
  return NextResponse.redirect(flowPublicUrl("/payment-result"), 303);
}
