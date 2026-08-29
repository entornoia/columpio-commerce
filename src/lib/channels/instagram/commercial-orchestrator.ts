import type { SupabaseClient } from "@supabase/supabase-js";
import { searchCatalog, type CatalogSearchResult } from "../../catalog-search.ts";
import { loadCommerceSnapshot } from "../../commerce/commerce-snapshot.ts";
import { resolveCommerceAction } from "../../commerce/conversation-resolver.ts";
import { formatCommerceResponse } from "../../commerce/response-formatter.ts";
import { executeCommerceTool } from "../../commerce/tools.ts";
import type { InstagramCommerceContext } from "../../commerce/types.ts";
import type { InstagramConversationContext } from "./conversation-state.ts";
import { getInstagramSemanticFocus, setInstagramSemanticFocus } from "./focus-repository.ts";
import { resolveCommerceReference } from "./reference-resolver.ts";
import { interpretSemanticCommerce, type SemanticInterpreter } from "./semantic-interpreter.ts";
import type { SemanticCommerceInterpretation, SemanticAttribute } from "./semantic-schema.ts";
import { normalizeSemanticCatalogSearch, searchSemanticCatalog } from "./catalog-normalizer.ts";
import { instagramOperationalLog } from "./logging.ts";

export type SemanticCommerceOutcome = { responseText: string; action: string; mutated: boolean };
type Args = { supabase: SupabaseClient; externalUserId: string; eventId: string; receivedAt: string; messageText: string; conversationContext: InstagramConversationContext; authorizeMutation: InstagramCommerceContext["authorizeMutation"]; interpret?: SemanticInterpreter };

const money = (value: number) => `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)}`;
const natural = (values: string[]) => values.length < 2 ? values[0] ?? "" : `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;
const unique = (values: string[]) => [...new Set(values)];
const checkoutStage = (snapshot: Awaited<ReturnType<typeof loadCommerceSnapshot>>) => snapshot.flowCheckoutStatus === "ready" ? "ready" as const : snapshot.flowCheckoutStatus === "creating" ? "creating" as const : snapshot.flowCheckoutStatus === "uncertain" ? "uncertain" as const : snapshot.flowCheckoutStatus === "failed" ? "failed" as const : snapshot.latestOrderStatus === "pending_payment" && !snapshot.payerEmailPresent ? "needs_email" as const : "none" as const;

function formatSearch(results: CatalogSearchResult[]) {
  if (!results.length) return "No encontré una opción disponible con esas características.";
  if (results.length === 1) {
    const product = results[0]; const available = product.compatibleVariants.filter((variant) => variant.stock > 0);
    const colors = unique(available.map((variant) => variant.color));
    const sizes = unique(available.map((variant) => variant.size));
    if (colors.length === 1) return `Sí, tengo ${product.name} en ${colors[0].toLocaleLowerCase("es-CL")}, disponible en ${natural(sizes)} a ${money(product.price)}.`;
    return `Sí 😊 tenemos ${product.name} a ${money(product.price)}. Está disponible en ${natural(available.map((variant) => `${variant.color} talla ${variant.size}`))}.`;
  }
  return `Encontré estas opciones: ${results.slice(0, 3).map((product) => `${product.name} · ${money(product.price)}`).join("; ")}. ¿Cuál quieres ver?`;
}

function attributeResponse(product: CatalogSearchResult, attribute: SemanticAttribute | null) {
  const variants = product.compatibleVariants.filter((variant) => variant.stock > 0);
  if ((attribute === "material" || attribute === "composition") && product.material) return `${product.name} está registrada en ${product.material}.`;
  if (attribute === "fit" && product.fit) return `El calce registrado de ${product.name} es ${product.fit}.`;
  if (attribute === "price") return `${product.name} está a ${money(product.price)}.`;
  if (attribute === "color") return `${product.name} está disponible en ${natural(unique(variants.map((variant) => variant.color)))}.`;
  if (attribute === "size") return `${product.name} está disponible en talla ${natural(unique(variants.map((variant) => variant.size)))}.`;
  if (attribute === "availability") return variants.length ? `${product.name} tiene disponibilidad en ${variants.map((variant) => `${variant.color} talla ${variant.size}`).join(", ")}.` : `${product.name} no tiene stock disponible en este momento.`;
  return "Ese dato no lo tengo registrado.";
}

function clarification(interpretation: SemanticCommerceInterpretation, focusName: string | null) {
  if (interpretation.action === "recommend_complement" && focusName) return `¿Quieres que te busque una opción para combinar con ${focusName}?`;
  if (focusName) return `¿Te refieres a ${focusName}, que estábamos viendo?`;
  return "¿Qué producto quieres ver o comprar?";
}

export async function runSemanticCommerceOrchestrator(args: Args): Promise<SemanticCommerceOutcome> {
  const focus = await getInstagramSemanticFocus(args.supabase, args.externalUserId);
  const snapshot = await loadCommerceSnapshot(args.supabase, args.externalUserId, { productId: focus.productId, variantId: focus.variantId });
  const interpretation = await (args.interpret ?? interpretSemanticCommerce)({
    message: args.messageText,
    focus: snapshot.focusedProduct ? { name: snapshot.focusedProduct.name, category: focus.category, color: snapshot.focusedVariant?.color ?? null, size: snapshot.focusedVariant?.size ?? null } : null,
    hasSelection: snapshot.selectedItems.length > 0, selectedKinds: snapshot.selectedItems.length,
    hasOrder: snapshot.latestOrder !== null, checkoutStage: checkoutStage(snapshot), conversationState: args.conversationContext.state,
  });
  if (!interpretation || interpretation.confidence < 0.75 || interpretation.needsClarification || interpretation.action === "clarify") return { responseText: clarification(interpretation ?? ({ action: "clarify" } as SemanticCommerceInterpretation), snapshot.focusedProduct?.name ?? null), action: "clarify", mutated: false };
  if (["after_sales", "order_tracking", "human_request"].includes(interpretation.action)) return { responseText: "Para ayudarte bien con eso, ¿me confirmas si necesitas atención de una persona?", action: "clarify", mutated: false };

  if (interpretation.action === "search_product") {
    const normalized = normalizeSemanticCatalogSearch({
      productName: interpretation.reference.productName,
      referenceCategory: interpretation.reference.category,
      targetCategory: interpretation.target.category,
      referenceColor: interpretation.reference.color,
      targetColor: interpretation.target.color,
      size: interpretation.target.size,
    });
    const searched = await searchSemanticCatalog(args.supabase, normalized);
    const results = searched.results;
    instagramOperationalLog("semantic catalog search", {
      action: interpretation.action,
      referenceCategory: interpretation.reference.category,
      referenceColor: interpretation.reference.color,
      targetCategory: interpretation.target.category,
      targetColor: interpretation.target.color,
      normalizedCategory: normalized.canonicalCategory,
      normalizedColor: normalized.canonicalColor,
      attempts: searched.attempts,
      resultCount: results.length,
    });
    if (results.length === 1) {
      const variants = results[0].compatibleVariants.filter((variant) => variant.stock > 0);
      await setInstagramSemanticFocus(args.supabase, args.externalUserId, { productId: results[0].id, variantId: variants.length === 1 ? variants[0].id : null, category: results[0].category }, args.receivedAt);
    }
    return { responseText: formatSearch(results), action: interpretation.action, mutated: false };
  }

  if (interpretation.action === "review_selection") {
    return { responseText: snapshot.latestOrder && snapshot.latestOrderStatus === "pending_payment" ? formatCommerceResponse("create_order", snapshot.latestOrder, {}) : snapshot.selectedItems.length ? formatCommerceResponse("view_cart", snapshot.selection, {}) : "Todavía no tienes piezas seleccionadas.", action: interpretation.action, mutated: false };
  }
  if (interpretation.action === "checkout") {
    const resolution = resolveCommerceAction("pay", snapshot, null, args.conversationContext);
    if (resolution.kind === "tool") {
      const emailMatch = args.messageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      const input = resolution.tool === "create_payment_link" ? { payerEmail: emailMatch?.[0] ?? null } : resolution.input;
      const result = await executeCommerceTool({ supabase: args.supabase, externalUserId: args.externalUserId, eventId: args.eventId, authorizeMutation: args.authorizeMutation }, resolution.tool, input);
      return { responseText: formatCommerceResponse(resolution.tool, result, input), action: interpretation.action, mutated: true };
    }
    return { responseText: resolution.kind === "snapshot_response" || resolution.kind === "clarify" ? resolution.response : "¿Qué producto quieres comprar?", action: interpretation.action, mutated: false };
  }

  const requiresFreshFocus = interpretation.reference.kind === "focus";
  const resolved = await resolveCommerceReference({ supabase: args.supabase, interpretation, focus, snapshot, receivedAt: args.receivedAt, requiresFreshFocus });
  if (resolved.kind !== "resolved") return { responseText: resolved.response, action: "clarify", mutated: false };
  const { product } = resolved.value;

  if (interpretation.action === "ask_product_attribute") return { responseText: attributeResponse(product, interpretation.attribute), action: interpretation.action, mutated: false };
  if (interpretation.action === "recommend_complement") {
    const results = await searchCatalog(args.supabase, { category: interpretation.target.category ?? undefined, color: interpretation.target.color ?? undefined, active: true, inStock: true });
    const candidates = results.filter((item) => item.id !== product.id).slice(0, 3);
    const responseText = candidates.length ? `Para combinar con ${product.name}, yo miraría ${candidates.map((item) => item.name).join(" o ")}. Son opciones reales disponibles del catálogo.` : `No encontré ahora una opción disponible para combinar con ${product.name}.`;
    return { responseText, action: interpretation.action, mutated: false };
  }
  if (interpretation.action === "select_product") {
    await setInstagramSemanticFocus(args.supabase, args.externalUserId, { productId: product.id, variantId: resolved.value.variant?.id ?? null, category: product.category }, args.receivedAt);
    return { responseText: `Perfecto, seguimos con ${product.name}. ¿Qué talla prefieres?`, action: interpretation.action, mutated: false };
  }
  if (interpretation.action === "select_variant" || interpretation.action === "set_quantity") {
    const variant = resolved.value.variant;
    if (!variant) {
      const available = product.compatibleVariants.filter((item) => item.stock > 0);
      return { responseText: `¿Qué talla prefieres para ${product.name}: ${natural(unique(available.map((item) => item.size)))}?`, action: "clarify", mutated: false };
    }
    await setInstagramSemanticFocus(args.supabase, args.externalUserId, { productId: product.id, variantId: variant.id, category: product.category }, args.receivedAt);
    const alreadySelected = snapshot.selectedItems.some((item) => item.variantId === variant.id);
    const tool = interpretation.action === "set_quantity" && alreadySelected ? "set_cart_quantity" : "add_to_cart";
    const input = { variantId: variant.id, quantity: interpretation.target.quantity ?? 1 };
    const result = await executeCommerceTool({ supabase: args.supabase, externalUserId: args.externalUserId, eventId: args.eventId, authorizeMutation: args.authorizeMutation }, tool, input);
    const verified = await executeCommerceTool({ supabase: args.supabase, externalUserId: args.externalUserId, eventId: args.eventId, authorizeMutation: args.authorizeMutation }, "view_cart", {});
    return { responseText: result.status === "business_error" ? formatCommerceResponse(tool, result, input) : formatCommerceResponse("view_cart", verified, {}), action: interpretation.action, mutated: true };
  }
  return { responseText: clarification(interpretation, product.name), action: "clarify", mutated: false };
}
