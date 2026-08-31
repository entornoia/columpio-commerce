import { NextResponse } from "next/server";
import { CART_COOKIE, assertSameOrigin } from "@/lib/storefront/cart-server";
import { validatePaymentRequest } from "@/lib/storefront/payment-contract";
import { createWebFlowPayment } from "@/lib/storefront/payment-server";

export const runtime = "nodejs";
function cartToken(request:Request){return request.headers.get("cookie")?.split(";").map((part)=>part.trim()).find((part)=>part.startsWith(`${CART_COOKIE}=`))?.slice(CART_COOKIE.length+1);}
export async function POST(request:Request){try{assertSameOrigin(request);const result=await createWebFlowPayment(cartToken(request),validatePaymentRequest(await request.json()));return NextResponse.json(result,{status:result.paymentUrl?200:202});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No pudimos iniciar el pago."},{status:400});}}
