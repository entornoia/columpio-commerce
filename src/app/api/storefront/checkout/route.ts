import { NextResponse } from "next/server";
import { CART_COOKIE, assertSameOrigin } from "@/lib/storefront/cart-server";
import { createCheckout } from "@/lib/storefront/checkout-server";
import { validateCheckoutInput } from "@/lib/storefront/checkout-contract";

function token(request: Request) { return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length + 1); }
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida." }, { status: 400 }); }

export async function POST(request: Request) {
  try { assertSameOrigin(request); return NextResponse.json(await createCheckout(token(request), validateCheckoutInput(await request.json()))); }
  catch (error) { return failure(error); }
}
