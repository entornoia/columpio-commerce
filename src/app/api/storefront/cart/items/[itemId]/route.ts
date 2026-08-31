import { NextResponse } from "next/server";
import { CART_COOKIE, assertSameOrigin, mutateCart } from "@/lib/storefront/cart-server";
import { positiveQuantity, uuid } from "@/lib/storefront/cart-contract";

type Context = { params: Promise<{ itemId: string }> };
function token(request: Request) { return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length + 1); }
function failure(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : "Solicitud inválida." }, { status: 400 }); }

export async function PATCH(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    const result = await mutateCart({ token: token(request), operation: "set_quantity", itemId: uuid((await context.params).itemId, "Item ID"), quantity: positiveQuantity(body.quantity) });
    return NextResponse.json(result.cart);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const result = await mutateCart({ token: token(request), operation: "remove", itemId: uuid((await context.params).itemId, "Item ID") });
    return NextResponse.json(result.cart);
  } catch (error) { return failure(error); }
}
