import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/storefront/cart-server";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { createServiceClient } from "@/lib/supabase/service";

const statuses=new Set(["unfulfilled","preparing","ready_for_pickup","shipped","delivered","returned"]);

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const {authorized,user}=await getAdministrativeSession();
    if(!authorized||!user)return NextResponse.json({error:"No autorizado."},{status:401});
    const {id}=await params; const body=await request.json();
    if(!statuses.has(body.expectedStatus)||!statuses.has(body.toStatus)||!(body.note===null||body.note===undefined||typeof body.note==="string"))return NextResponse.json({error:"Solicitud inválida."},{status:400});
    const {data,error}=await createServiceClient().rpc("transition_web_order_fulfillment",{p_order_id:id,p_expected_status:body.expectedStatus,p_to_status:body.toStatus,p_actor_user_id:user.id,p_note:body.note??null});
    if(error){
      const message=/Only paid|Payment is not|Invalid fulfillment|Fulfillment status changed|Order not found|Note is too long/.test(error.message)?error.message:"No se pudo actualizar fulfillment.";
      return NextResponse.json({error:message},{status:409});
    }
    return NextResponse.json({transition:data});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo actualizar fulfillment."},{status:400});}
}
