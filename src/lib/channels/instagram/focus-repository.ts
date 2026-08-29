import type { SupabaseClient } from "@supabase/supabase-js";

export type InstagramSemanticFocus = {
  productId: string | null; variantId: string | null; category: string | null; updatedAt: string | null;
};

export function isFocusFresh(focus: InstagramSemanticFocus, now: string, maxMinutes = 30) {
  if (!focus.updatedAt) return false;
  const elapsed = Date.parse(now) - Date.parse(focus.updatedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= maxMinutes * 60_000;
}

export async function getInstagramSemanticFocus(supabase: SupabaseClient, externalUserId: string): Promise<InstagramSemanticFocus> {
  const { data, error } = await supabase.from("instagram_conversations")
    .select("focus_product_id, focus_variant_id, focus_category, focus_updated_at")
    .eq("channel", "instagram").eq("external_user_id", externalUserId).single();
  if (error || !data) throw new Error(`No se pudo consultar el foco comercial: ${error?.message ?? "conversación inexistente"}`);
  return {
    productId: typeof data.focus_product_id === "string" ? data.focus_product_id : null,
    variantId: typeof data.focus_variant_id === "string" ? data.focus_variant_id : null,
    category: typeof data.focus_category === "string" ? data.focus_category : null,
    updatedAt: typeof data.focus_updated_at === "string" ? data.focus_updated_at : null,
  };
}

export async function setInstagramSemanticFocus(supabase: SupabaseClient, externalUserId: string, focus: Omit<InstagramSemanticFocus, "updatedAt">, changedAt: string) {
  const { data, error } = await supabase.rpc("set_instagram_semantic_focus", {
    p_external_user_id: externalUserId, p_product_id: focus.productId, p_variant_id: focus.variantId,
    p_category: focus.category, p_changed_at: changedAt,
  }).single();
  if (error || !data) throw new Error(`No se pudo actualizar el foco comercial: ${error?.message ?? "sin respuesta"}`);
  return data;
}

export function clearInstagramSemanticFocus(supabase: SupabaseClient, externalUserId: string, changedAt: string) {
  return setInstagramSemanticFocus(supabase, externalUserId, { productId: null, variantId: null, category: null }, changedAt);
}
