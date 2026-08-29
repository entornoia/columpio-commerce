export const semanticActions = [
  "search_product", "recommend_complement", "ask_product_attribute", "purchase_cta",
  "after_sales", "exchange_return", "order_tracking", "human_request", "clarify",
] as const;

export const semanticAttributes = [
  "material", "composition", "sleeve", "length", "fit", "color", "size", "price", "availability",
] as const;

export const semanticReasonCodes = [
  "explicit_search", "styling_request", "attribute_question", "purchase_request",
  "after_sales_signal", "exchange_return_signal", "order_tracking_signal",
  "human_request_signal", "ambiguous_reference", "ambiguous_action", "insufficient_context",
] as const;

export type SemanticAction = (typeof semanticActions)[number];
/** Contrato histórico conservado solo para que el código 3A.5 deprecated compile; no forma parte del JSON Schema advisor. */
export type DeprecatedTransactionalSemanticAction = "select_product" | "select_variant" | "set_quantity" | "review_selection" | "checkout";
export type SemanticAttribute = (typeof semanticAttributes)[number];
export type SemanticReasonCode = (typeof semanticReasonCodes)[number];
export type SemanticReferenceKind = "explicit" | "focus" | "selection" | "unknown";

export type SemanticCommerceInterpretation = {
  action: SemanticAction | DeprecatedTransactionalSemanticAction;
  reference: { kind: SemanticReferenceKind; productName: string | null; category: string | null; color: string | null; size: string | null };
  target: { category: string | null; color: string | null; size: string | null; quantity: number | null };
  attribute: SemanticAttribute | null;
  confidence: number;
  needsClarification: boolean;
  reasonCode: SemanticReasonCode;
};

const nullableString = { type: ["string", "null"], maxLength: 120 } as const;
export const semanticCommerceJsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    action: { type: "string", enum: semanticActions },
    reference: { type: "object", additionalProperties: false, properties: {
      kind: { type: "string", enum: ["explicit", "focus", "selection", "unknown"] },
      product_name: nullableString, category: nullableString, color: nullableString, size: nullableString,
    }, required: ["kind", "product_name", "category", "color", "size"] },
    target: { type: "object", additionalProperties: false, properties: {
      category: nullableString, color: nullableString, size: nullableString,
      quantity: { type: ["integer", "null"], minimum: 1, maximum: 20 },
    }, required: ["category", "color", "size", "quantity"] },
    attribute: { type: ["string", "null"], enum: [...semanticAttributes, null] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    needs_clarification: { type: "boolean" },
    reason_code: { type: "string", enum: semanticReasonCodes },
  },
  required: ["action", "reference", "target", "attribute", "confidence", "needs_clarification", "reason_code"],
} as const;

const clean = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;

export function validateSemanticCommerceInterpretation(value: unknown): SemanticCommerceInterpretation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const reference = row.reference as Record<string, unknown> | null;
  const target = row.target as Record<string, unknown> | null;
  if (!semanticActions.includes(row.action as SemanticAction) || !reference || !target) return null;
  if (!["explicit", "focus", "selection", "unknown"].includes(String(reference.kind))) return null;
  if (!semanticReasonCodes.includes(row.reason_code as SemanticReasonCode)) return null;
  if (row.attribute !== null && !semanticAttributes.includes(row.attribute as SemanticAttribute)) return null;
  if (typeof row.confidence !== "number" || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1 || typeof row.needs_clarification !== "boolean") return null;
  const quantity = target.quantity;
  if (quantity !== null && (!Number.isInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 20)) return null;
  return {
    action: row.action as SemanticAction,
    reference: { kind: reference.kind as SemanticReferenceKind, productName: clean(reference.product_name), category: clean(reference.category), color: clean(reference.color), size: clean(reference.size) },
    target: { category: clean(target.category), color: clean(target.color), size: clean(target.size), quantity: quantity === null ? null : Number(quantity) },
    attribute: row.attribute as SemanticAttribute | null,
    confidence: row.confidence, needsClarification: row.needs_clarification, reasonCode: row.reason_code as SemanticReasonCode,
  };
}
