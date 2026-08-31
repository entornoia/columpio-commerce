import { NextResponse } from "next/server";
import { assertSameOrigin, listShippingRegions, resolveShipping } from "@/lib/storefront/cart-server";

function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida." }, { status: 400 }); }

export async function GET() {
  try { return NextResponse.json({ regions: await listShippingRegions() }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { assertSameOrigin(request); const body = await request.json(); return NextResponse.json(await resolveShipping(body.method, body.regionCode, body.commune)); }
  catch (error) { return failure(error); }
}
