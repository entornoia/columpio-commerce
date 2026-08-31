import { NextResponse } from "next/server";
import { CART_COOKIE, assertSameOrigin, setCartDiscountCode } from "@/lib/storefront/cart-server";

function token(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length + 1);
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida." }, { status: 400 }); }

export async function PUT(request: Request) {
  try { assertSameOrigin(request); const body = await request.json(); return NextResponse.json(await setCartDiscountCode(token(request), body.code)); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try { assertSameOrigin(request); return NextResponse.json(await setCartDiscountCode(token(request), null)); }
  catch (error) { return failure(error); }
}
