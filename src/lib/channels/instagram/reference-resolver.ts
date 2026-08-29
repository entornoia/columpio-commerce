import type { SupabaseClient } from "@supabase/supabase-js";
import { searchCatalog, type CatalogSearchResult } from "../../catalog-search.ts";
import type { CommerceSnapshot } from "../../commerce/commerce-snapshot.ts";
import { isFocusFresh, type InstagramSemanticFocus } from "./focus-repository.ts";
import type { SemanticCommerceInterpretation } from "./semantic-schema.ts";

export type ResolvedCommerceReference = { product: CatalogSearchResult; variant: CatalogSearchResult["compatibleVariants"][number] | null; source: "explicit" | "focus" | "selection" };
export type ReferenceResolution = { kind: "resolved"; value: ResolvedCommerceReference } | { kind: "ambiguous"; response: string } | { kind: "missing"; response: string };

export type AdvisorReferenceResolution = { kind: "resolved"; product: CatalogSearchResult } | { kind: "ambiguous" | "missing"; response: string };

async function byId(supabase: SupabaseClient, productId: string) {
  const all = await searchCatalog(supabase, { active: true });
  return all.find((product) => product.id === productId) ?? null;
}

function matchVariant(product: CatalogSearchResult, color: string | null, size: string | null, preferredId?: string | null) {
  const normalized = (value: string) => value.trim().toLocaleLowerCase("es-CL");
  const candidates = product.compatibleVariants.filter((variant) => variant.active && variant.stock > 0
    && (!color || normalized(variant.color) === normalized(color)) && (!size || normalized(variant.size) === normalized(size)));
  if (preferredId) return candidates.find((variant) => variant.id === preferredId) ?? (candidates.length === 1 ? candidates[0] : null);
  return candidates.length === 1 ? candidates[0] : null;
}

export async function resolveCommerceReference(args: {
  supabase: SupabaseClient; interpretation: SemanticCommerceInterpretation; focus: InstagramSemanticFocus;
  snapshot: CommerceSnapshot; receivedAt: string; requiresFreshFocus?: boolean;
}): Promise<ReferenceResolution> {
  const { supabase, interpretation, focus, snapshot } = args;
  const explicit = interpretation.reference.productName || interpretation.reference.category;
  if (explicit) {
    const results = await searchCatalog(supabase, { query: interpretation.reference.productName ?? undefined, category: interpretation.reference.category ?? undefined, active: true, inStock: true });
    if (results.length > 1) return { kind: "ambiguous", response: `Encontré más de una opción. ¿Cuál de ellas quieres usar?` };
    if (results.length === 1) return { kind: "resolved", value: { product: results[0], variant: matchVariant(results[0], interpretation.reference.color ?? interpretation.target.color, interpretation.reference.size ?? interpretation.target.size), source: "explicit" } };
  }
  if (focus.productId && (!args.requiresFreshFocus || isFocusFresh(focus, args.receivedAt))) {
    const product = await byId(supabase, focus.productId);
    if (product) return { kind: "resolved", value: { product, variant: matchVariant(product, interpretation.reference.color ?? interpretation.target.color, interpretation.reference.size ?? interpretation.target.size, focus.variantId), source: "focus" } };
  }
  if (args.requiresFreshFocus && focus.productId && !isFocusFresh(focus, args.receivedAt)) return { kind: "missing", response: "¿Qué producto quieres retomar? Así confirmo nuevamente la variante disponible." };
  if (snapshot.selectedItems.length === 1) {
    const item = snapshot.selectedItems[0]; const productId = typeof item.productId === "string" ? item.productId : null;
    if (productId) { const product = await byId(supabase, productId); if (product) return { kind: "resolved", value: { product, variant: matchVariant(product, interpretation.reference.color ?? interpretation.target.color, interpretation.reference.size ?? interpretation.target.size, typeof item.variantId === "string" ? item.variantId : null), source: "selection" } }; }
  }
  return { kind: "missing", response: "¿De qué producto me hablas?" };
}

export async function resolveAdvisorReference(args: { supabase: SupabaseClient; interpretation: SemanticCommerceInterpretation; focus: InstagramSemanticFocus; receivedAt: string }): Promise<AdvisorReferenceResolution> {
  const explicit = args.interpretation.reference.productName || args.interpretation.reference.category;
  if (explicit) {
    const normalized = (await import("./catalog-normalizer.ts")).normalizeSemanticCatalogSearch({
      productName: args.interpretation.reference.productName,
      referenceCategory: args.interpretation.reference.category,
      targetCategory: args.interpretation.target.category,
      referenceColor: args.interpretation.reference.color,
      targetColor: args.interpretation.target.color,
      size: args.interpretation.target.size,
    });
    const searched = await (await import("./catalog-normalizer.ts")).searchSemanticCatalog(args.supabase, normalized);
    if (searched.results.length === 1) return { kind: "resolved", product: searched.results[0] };
    if (searched.results.length > 1) return { kind: "ambiguous", response: "Encontré más de una opción. ¿Cuál quieres consultar?" };
  }
  if (args.focus.productId && isFocusFresh(args.focus, args.receivedAt)) {
    const product = await byId(args.supabase, args.focus.productId);
    if (product) return { kind: "resolved", product };
  }
  return { kind: "missing", response: "¿De qué producto me hablas?" };
}
