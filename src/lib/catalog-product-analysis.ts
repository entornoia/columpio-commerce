import OpenAI from "openai";
import { DEFAULT_GARMENT_VISION_MODEL } from "./agent/config";
import { validateGarmentImage, type GarmentImage } from "./agent/garment-analysis";

export const CATALOG_CATEGORY_SLUGS = ["vestidos", "blusas", "poleras", "pantalones", "chaquetas", "accesorios"] as const;
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
  const model = DEFAULT_GARMENT_VISION_MODEL;
  const response = await openai.responses.create({
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
  return { analysis: validateCatalogProductAnalysis(JSON.parse(response.output_text)), usage: response.usage, model };
}

export function validatedCatalogImageFromBytes(bytes: Uint8Array, mimeType: string) {
  const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
  return validateGarmentImage(dataUrl);
}
