import OpenAI from "openai";
import { DEFAULT_GARMENT_VISION_MODEL } from "./agent/config";
import { validateGarmentImage, type GarmentImage } from "./agent/garment-analysis";

export const CATALOG_CATEGORY_SLUGS = ["vestidos", "blusas", "poleras", "pantalones", "chaquetas", "accesorios"] as const;
export const CATALOG_PRODUCT_ANALYSIS_MODEL = DEFAULT_GARMENT_VISION_MODEL;
export const CATALOG_PRODUCT_ANALYSIS_STAGES = [
  "openai_request", "openai_response", "response_parse", "category_resolution", "analysis_finalize",
] as const;
export type CatalogProductAnalysisStage = typeof CATALOG_PRODUCT_ANALYSIS_STAGES[number];
type ProductAnalysisDiagnostic = {
  stage: CatalogProductAnalysisStage;
  model: string;
  httpStatus: number | null;
  errorType: string | null;
  errorCode: string | null;
  message: string;
};

const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 320;

export class CatalogProductAnalysisStageError extends Error {
  constructor(
    readonly stage: CatalogProductAnalysisStage,
    readonly diagnosticCode: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "CatalogProductAnalysisStageError";
  }
}

export function sanitizeProductAnalysisDiagnosticMessage(value: unknown) {
  const text = typeof value === "string" ? value : "Product analysis failed.";
  return text
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[redacted-image]")
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, "[redacted-secret]")
    .replace(/\bbearer\s+[a-z0-9._~+/-]+=*/gi, "Bearer [redacted-secret]")
    .replace(/\b(authorization|api[-_ ]?key)\s*[:=]\s*\S+/gi, "$1=[redacted-secret]")
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/<[^>]*>/g, " ")
    .replace(/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[redacted-data]")
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DIAGNOSTIC_MESSAGE_LENGTH);
}

function safeDiagnosticIdentifier(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80);
}

export function productAnalysisDiagnostic(
  error: unknown,
  fallbackStage: CatalogProductAnalysisStage,
): ProductAnalysisDiagnostic {
  const staged = error instanceof CatalogProductAnalysisStageError ? error : null;
  const source = staged?.originalError ?? error;
  const apiError = source instanceof OpenAI.APIError ? source : null;
  const genericError = source instanceof Error ? source : null;
  return {
    stage: staged?.stage ?? fallbackStage,
    model: CATALOG_PRODUCT_ANALYSIS_MODEL,
    httpStatus: typeof apiError?.status === "number" ? apiError.status : null,
    errorType: safeDiagnosticIdentifier(apiError?.type ?? genericError?.name),
    errorCode: safeDiagnosticIdentifier(apiError?.code ?? staged?.diagnosticCode),
    message: sanitizeProductAnalysisDiagnosticMessage(apiError?.message ?? genericError?.message ?? staged?.message),
  };
}
export type CatalogCategorySlug = typeof CATALOG_CATEGORY_SLUGS[number];
export type SuggestionBasis = "observable" | "inferred";
export type SuggestionConfidence = "high" | "medium" | "low";
export type CatalogSuggestion = { value: string | null; basis: SuggestionBasis; confidence: SuggestionConfidence };
export type CatalogProductAnalysis = {
  commercialName: CatalogSuggestion;
  normalizedCategorySlug: { value: CatalogCategorySlug | null; basis: SuggestionBasis; confidence: SuggestionConfidence };
  legacyCategory: CatalogSuggestion;
  legacySubcategory: CatalogSuggestion;
  primaryColor: CatalogSuggestion;
  secondaryColors: CatalogSuggestion[];
  apparentMaterial: CatalogSuggestion;
  style: CatalogSuggestion;
  fit: CatalogSuggestion;
  season: CatalogSuggestion;
  formality: CatalogSuggestion;
  occasions: CatalogSuggestion[];
  shortDescription: CatalogSuggestion;
  description: CatalogSuggestion;
  seoTitle: CatalogSuggestion;
  seoDescription: CatalogSuggestion;
  visibleFeatures: string[];
  uncertainties: string[];
  notDetermined: string[];
};

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: ["string", "null"] },
    basis: { type: "string", enum: ["observable", "inferred"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["value", "basis", "confidence"],
} as const;

export const catalogProductAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commercialName: suggestionSchema,
    normalizedCategorySlug: {
      ...suggestionSchema,
      properties: { ...suggestionSchema.properties, value: { type: ["string", "null"], enum: [...CATALOG_CATEGORY_SLUGS, null] } },
    },
    legacyCategory: suggestionSchema,
    legacySubcategory: suggestionSchema,
    primaryColor: suggestionSchema,
    secondaryColors: { type: "array", items: suggestionSchema, maxItems: 6 },
    apparentMaterial: suggestionSchema,
    style: suggestionSchema,
    fit: suggestionSchema,
    season: suggestionSchema,
    formality: suggestionSchema,
    occasions: { type: "array", items: suggestionSchema, maxItems: 8 },
    shortDescription: suggestionSchema,
    description: suggestionSchema,
    seoTitle: suggestionSchema,
    seoDescription: suggestionSchema,
    visibleFeatures: { type: "array", items: { type: "string" }, maxItems: 12 },
    uncertainties: { type: "array", items: { type: "string" }, maxItems: 12 },
    notDetermined: { type: "array", items: { type: "string" }, maxItems: 20 },
  },
  required: [
    "commercialName", "normalizedCategorySlug", "legacyCategory", "legacySubcategory", "primaryColor",
    "secondaryColors", "apparentMaterial", "style", "fit", "season", "formality", "occasions",
    "shortDescription", "description", "seoTitle", "seoDescription", "visibleFeatures", "uncertainties", "notDetermined",
  ],
} as const;

function validateSuggestion(value: unknown): CatalogSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("La sugerencia de IA no es válida.");
  const item = value as Record<string, unknown>;
  if (item.value !== null && (typeof item.value !== "string" || item.value.length > 2_000)) throw new Error("La sugerencia de IA no es válida.");
  if (item.basis !== "observable" && item.basis !== "inferred") throw new Error("La base de la sugerencia no es válida.");
  if (!(["high", "medium", "low"] as unknown[]).includes(item.confidence)) throw new Error("La confianza de la sugerencia no es válida.");
  return { value: item.value as string | null, basis: item.basis, confidence: item.confidence } as CatalogSuggestion;
}

export function validateCatalogProductAnalysis(value: unknown): CatalogProductAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("El análisis de catálogo no es válido.");
  const item = value as Record<string, unknown>;
  const scalarKeys = ["commercialName", "normalizedCategorySlug", "legacyCategory", "legacySubcategory", "primaryColor", "apparentMaterial", "style", "fit", "season", "formality", "shortDescription", "description", "seoTitle", "seoDescription"] as const;
  const result = Object.fromEntries(scalarKeys.map((key) => [key, validateSuggestion(item[key])])) as unknown as CatalogProductAnalysis;
  const category = result.normalizedCategorySlug.value;
  if (category !== null && !CATALOG_CATEGORY_SLUGS.includes(category as CatalogCategorySlug)) throw new Error("La categoría sugerida no pertenece a la taxonomía permitida.");
  for (const key of ["secondaryColors", "occasions"] as const) {
    if (!Array.isArray(item[key])) throw new Error("La lista de sugerencias no es válida.");
    result[key] = item[key].map(validateSuggestion);
  }
  for (const key of ["visibleFeatures", "uncertainties", "notDetermined"] as const) {
    if (!Array.isArray(item[key]) || item[key].some((entry) => typeof entry !== "string" || entry.length > 500)) throw new Error("El detalle del análisis no es válido.");
    result[key] = item[key] as string[];
  }
  return result;
}

export async function analyzeCatalogProductImage(openai: OpenAI, image: GarmentImage) {
  const model = CATALOG_PRODUCT_ANALYSIS_MODEL;
  let response;
  try {
    response = await openai.responses.create({
      model,
      instructions: [
        "Analiza la prenda principal para ayudar a una administradora de Columpio Store a completar una ficha comercial.",
        "Distingue observaciones visuales de inferencias prudentes. Usa null cuando no puedas determinar un dato.",
        "Nunca generes precio, stock, tallas, SKU, composición textil exacta, porcentajes, fabricante, país de origen, medidas, lavado, propiedades técnicas, estado activo, estado editorial ni fecha de publicación.",
        "El material siempre debe describirse como aparente. La categoría normalizada sólo puede ser una de las opciones del schema.",
        "Redacta en español de Chile, con tono femenino, contemporáneo y sobrio. No presentes inferencias como hechos.",
      ].join(" "),
      input: [{ role: "user", content: [
        { type: "input_text", text: "Sugiere los campos editoriales de esta prenda en una sola respuesta estructurada." },
        { type: "input_image", image_url: image.dataUrl, detail: "auto" },
      ] }],
      text: { format: { type: "json_schema", name: "catalog_product_analysis", strict: true, schema: catalogProductAnalysisSchema } },
      store: false,
      max_output_tokens: 1_500,
    }, { timeout: 45_000 });
  } catch (error) {
    throw new CatalogProductAnalysisStageError("openai_request", "openai_request_failed", "OpenAI request failed.", error);
  }

  const hasRefusal = response.output.some((item) => item.type === "message"
    && item.content.some((content) => content.type === "refusal"));
  console.info("[catalog_product_analysis_response]", JSON.stringify({
    stage: "openai_response",
    model,
    responseStatus: response.status,
    hasResponseError: Boolean(response.error),
    hasIncompleteDetails: Boolean(response.incomplete_details),
    hasOutputText: Boolean(response.output_text?.trim()),
    hasRefusal,
  }));
  if (response.status !== "completed" || response.error || response.incomplete_details || hasRefusal) {
    throw new CatalogProductAnalysisStageError(
      "openai_response",
      response.status === "incomplete" || response.incomplete_details ? "incomplete_response"
        : hasRefusal ? "response_refusal" : "openai_response_failed",
      "OpenAI response was not completed.",
    );
  }
  if (!response.output_text?.trim()) {
    throw new CatalogProductAnalysisStageError("response_parse", "empty_output_text", "OpenAI returned no structured output.");
  }
  try {
    return { analysis: validateCatalogProductAnalysis(JSON.parse(response.output_text)), usage: response.usage, model };
  } catch (error) {
    throw new CatalogProductAnalysisStageError("response_parse", "invalid_structured_output", "OpenAI structured output was invalid.", error);
  }
}

export function validatedCatalogImageFromBytes(bytes: Uint8Array, mimeType: string) {
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  return validateGarmentImage(dataUrl);
}
