import { NextResponse } from "next/server";
import { CART_COOKIE, CART_COOKIE_OPTIONS, assertSameOrigin, mutateCart, readCart } from "@/lib/storefront/cart-server";
import { positiveQuantity, uuid } from "@/lib/storefront/cart-contract";

function token(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length + 1);
}
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida." }, { status: 400 }); }

export async function GET(request: Request) {
  try { return NextResponse.json(await readCart(token(request))); }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    const result = await mutateCart({ token: token(request), operation: "add", variantId: uuid(body.variantId, "Variant ID"), quantity: positiveQuantity(body.quantity) });
    const response = NextResponse.json(result.cart);
    if (result.createdToken) response.cookies.set(CART_COOKIE, result.createdToken, CART_COOKIE_OPTIONS);
    return response;
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const result = await mutateCart({ token: token(request), operation: "clear" });
    return NextResponse.json(result.cart);
  } catch (error) { return failure(error); }
}
