import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogSearchResult } from "../../catalog-search.ts";
import { normalizeSemanticCatalogSearch, searchSemanticCatalog } from "./catalog-normalizer.ts";
import { getInstagramSemanticFocus, setInstagramSemanticFocus } from "./focus-repository.ts";
import { instagramOperationalLog } from "./logging.ts";
import { formatInstagramPurchaseCta } from "./purchase-cta.ts";
import { resolveAdvisorReference } from "./reference-resolver.ts";
import { interpretSemanticCommerce, type SemanticInterpreter } from "./semantic-interpreter.ts";
import type { SemanticAttribute, SemanticCommerceInterpretation } from "./semantic-schema.ts";

export type AdvisorHandoffIntent = "exchange_return" | "after_sales" | "order_tracking" | "human_request";
export type InstagramAdvisorOutcome = { responseText: string; action: string; handoffIntent?: AdvisorHandoffIntent };

type AdvisorArgs = {
  supabase: SupabaseClient; externalUserId: string; receivedAt: string; messageText: string;
  conversationState: string; interpret?: SemanticInterpreter;
};

const money = (value: number) => `$${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(value)}`;
const unique = (values: string[]) => [...new Set(values)];
const natural = (values: string[]) => values.length < 2 ? values[0] ?? "" : `${values.slice(0, -1).join(", ")} y ${values.at(-1)}`;

function formatSearch(results: CatalogSearchResult[]) {
  if (!results.length) return "No encontré una opción disponible con esas características.";
  if (results.length > 1) return `Encontré estas opciones: ${results.slice(0, 3).map((product) => `${product.name} · ${money(product.price)}`).join("; ")}. ¿Cuál quieres ver?`;
  const product = results[0]; const variants = product.compatibleVariants.filter((variant) => variant.stock > 0);
  const colors = unique(variants.map((variant) => variant.color)); const sizes = unique(variants.map((variant) => variant.size));
  const variantText = colors.length === 1
    ? `en ${colors[0].toLocaleLowerCase("es-CL")}, disponible en ${natural(sizes)}`
    : `disponible en ${natural(variants.map((variant) => `${variant.color} talla ${variant.size}`))}`;
  return `Sí, tengo ${product.name} ${variantText} a ${money(product.price)}.`;
}

function formatAttribute(product: CatalogSearchResult, attribute: SemanticAttribute | null) {
  const variants = product.compatibleVariants.filter((variant) => variant.stock > 0);
  if ((attribute === "material" || attribute === "composition") && product.material) return `${product.name} está registrada en ${product.material}.`;
  if (attribute === "fit" && product.fit) return `El calce registrado de ${product.name} es ${product.fit}.`;
  if (attribute === "price") return `${product.name} está a ${money(product.price)}.`;
  if (attribute === "color" && variants.length) return `${product.name} está disponible en ${natural(unique(variants.map((variant) => variant.color)))}.`;
  if (attribute === "size" && variants.length) return `${product.name} está disponible en talla ${natural(unique(variants.map((variant) => variant.size)))}.`;
  if (attribute === "availability") return variants.length
    ? `${product.name} tiene disponibilidad en ${variants.map((variant) => `${variant.color} talla ${variant.size}, ${variant.stock} en stock`).join("; ")}.`
    : `${product.name} no tiene stock disponible en este momento.`;
  return "Ese dato no lo tengo registrado.";
}

function clarify(interpretation: SemanticCommerceInterpretation | null, focusName: string | null) {
  if (interpretation?.action === "recommend_complement" && focusName) return `¿Quieres que te busque una opción para combinar con ${focusName}?`;
  if (focusName) return `¿Te refieres a ${focusName}, que estábamos viendo?`;
  return "¿Qué producto quieres buscar o consultar?";
}

export async function runInstagramAdvisor(args: AdvisorArgs): Promise<InstagramAdvisorOutcome> {
  const focus = await getInstagramSemanticFocus(args.supabase, args.externalUserId);
  let focusProduct: CatalogSearchResult | null = null;
  if (focus.productId) {
    const all = await searchSemanticCatalog(args.supabase, normalizeSemanticCatalogSearch({ productName: null, referenceCategory: focus.category, targetCategory: focus.category, referenceColor: null, targetColor: null }));
    focusProduct = all.results.find((product) => product.id === focus.productId) ?? null;
  }
  const interpretation = await (args.interpret ?? interpretSemanticCommerce)({
    message: args.messageText,
    focus: focusProduct ? { name: focusProduct.name, category: focusProduct.category, color: null, size: null } : null,
    conversationState: args.conversationState,
  });
  if (!interpretation || interpretation.confidence < 0.75 || interpretation.needsClarification || interpretation.action === "clarify") return { responseText: clarify(interpretation, focusProduct?.name ?? null), action: "clarify" };
  if (["exchange_return", "after_sales", "order_tracking", "human_request"].includes(interpretation.action)) {
    return { responseText: "", action: interpretation.action, handoffIntent: interpretation.action as AdvisorHandoffIntent };
  }
  if (interpretation.action === "purchase_cta") return { responseText: formatInstagramPurchaseCta(), action: interpretation.action };

  if (interpretation.action === "search_product") {
    const normalized = normalizeSemanticCatalogSearch({
      productName: interpretation.reference.productName, referenceCategory: interpretation.reference.category,
      targetCategory: interpretation.target.category, referenceColor: interpretation.reference.color,
      targetColor: interpretation.target.color, size: interpretation.target.size,
    });
    const searched = await searchSemanticCatalog(args.supabase, normalized);
    instagramOperationalLog("advisor catalog search", { normalizedCategory: normalized.canonicalCategory, normalizedColor: normalized.canonicalColor, attempts: searched.attempts, resultCount: searched.results.length });
    if (searched.results.length === 1) await setInstagramSemanticFocus(args.supabase, args.externalUserId, { productId: searched.results[0].id, variantId: null, category: searched.results[0].category }, args.receivedAt);
    return { responseText: formatSearch(searched.results), action: interpretation.action };
  }

  const resolved = await resolveAdvisorReference({ supabase: args.supabase, interpretation, focus, receivedAt: args.receivedAt });
  if (resolved.kind !== "resolved") return { responseText: resolved.response, action: "clarify" };
  if (interpretation.action === "ask_product_attribute") return { responseText: formatAttribute(resolved.product, interpretation.attribute), action: interpretation.action };
  if (interpretation.action === "recommend_complement") {
    const normalized = normalizeSemanticCatalogSearch({ productName: null, referenceCategory: interpretation.target.category, targetCategory: interpretation.target.category, referenceColor: interpretation.target.color, targetColor: interpretation.target.color });
    const searched = await searchSemanticCatalog(args.supabase, normalized);
    const candidates = searched.results.filter((product) => product.id !== resolved.product.id).slice(0, 3);
    return { responseText: candidates.length
      ? `Para combinar con ${resolved.product.name}, yo miraría ${candidates.map((product) => product.name).join(" o ")}. Son opciones disponibles de nuestro catálogo.`
      : `No encontré ahora una opción disponible para combinar con ${resolved.product.name}.`, action: interpretation.action };
  }
  return { responseText: clarify(interpretation, resolved.product.name), action: "clarify" };
}
