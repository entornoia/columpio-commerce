import { NextResponse } from "next/server";
import { CART_COOKIE } from "@/lib/storefront/cart-server";
import { getWebPaymentResult } from "@/lib/storefront/payment-server";

export const runtime="nodejs";
function cartToken(request:Request){return request.headers.get("cookie")?.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length+1);}
export async function GET(request:Request){try{const result=await getWebPaymentResult(cartToken(request));return result?NextResponse.json(result):NextResponse.json({error:"Pedido no encontrado."},{status:404});}catch{return NextResponse.json({error:"No pudimos consultar el pago."},{status:500});}}
