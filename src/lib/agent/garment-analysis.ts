import OpenAI from "openai";
import { ALLOWED_GARMENT_IMAGE_TYPES, garmentVisionModel, MAX_GARMENT_IMAGE_BYTES } from "./config";

export type GarmentAnalysis = {
  garmentType: string | null;
  category: string | null;
  primaryColor: string | null;
  secondaryColors: string[];
  pattern: string | null;
  apparentMaterial: string | null;
  apparentFit: string | null;
  style: string[];
  formality: number | null;
  season: string[];
  occasions: string[];
  notableFeatures: string[];
  confidenceNotes: string[];
};

export type GarmentImage = { dataUrl: string; mimeType: typeof ALLOWED_GARMENT_IMAGE_TYPES[number]; size: number };
export type TemporaryGarment = GarmentAnalysis & { id: string };

const garmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    garmentType: { type: ["string", "null"] }, category: { type: ["string", "null"] },
    primaryColor: { type: ["string", "null"] }, secondaryColors: { type: "array", items: { type: "string" } },
    pattern: { type: ["string", "null"] }, apparentMaterial: { type: ["string", "null"] },
    apparentFit: { type: ["string", "null"] }, style: { type: "array", items: { type: "string" } },
    formality: { type: ["number", "null"], minimum: 1, maximum: 5 },
    season: { type: "array", items: { type: "string" } }, occasions: { type: "array", items: { type: "string" } },
    notableFeatures: { type: "array", items: { type: "string" } }, confidenceNotes: { type: "array", items: { type: "string" } },
  },
  required: ["garmentType", "category", "primaryColor", "secondaryColors", "pattern", "apparentMaterial", "apparentFit", "style", "formality", "season", "occasions", "notableFeatures", "confidenceNotes"],
};

function detectedMime(bytes: Buffer): GarmentImage["mimeType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export function validateGarmentImage(value: unknown): GarmentImage {
  if (typeof value !== "string") throw new Error("La imagen adjunta no es válida.");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("Solo se aceptan imágenes JPEG, PNG o WebP.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_GARMENT_IMAGE_BYTES) throw new Error("La imagen debe pesar como máximo 5 MB.");
  const actualType = detectedMime(bytes);
  if (!actualType || actualType !== match[1]) throw new Error("El contenido del archivo no coincide con un formato de imagen permitido.");
  return { dataUrl: value, mimeType: actualType, size: bytes.length };
}

export function validateGarmentAnalysis(value: unknown): GarmentAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("El contexto visual no es válido.");
  const item = value as Record<string, unknown>;
  const nullable = ["garmentType", "category", "primaryColor", "pattern", "apparentMaterial", "apparentFit"] as const;
  const arrays = ["secondaryColors", "style", "season", "occasions", "notableFeatures", "confidenceNotes"] as const;
  for (const key of nullable) if (item[key] !== null && (typeof item[key] !== "string" || item[key].length > 160)) throw new Error("El contexto visual no es válido.");
  for (const key of arrays) if (!Array.isArray(item[key]) || item[key].length > 12 || item[key].some((entry) => typeof entry !== "string" || entry.length > 160)) throw new Error("El contexto visual no es válido.");
  if (item.formality !== null && (typeof item.formality !== "number" || item.formality < 1 || item.formality > 5)) throw new Error("El contexto visual no es válido.");
  return item as GarmentAnalysis;
}

export function isGarmentAnalysisUnclear(analysis: GarmentAnalysis) {
  return !analysis.garmentType || analysis.confidenceNotes.some((note) => /(muy\s+)?(borros|desenfoc)|no se distingu|no permite identificar|no identificable/i.test(note));
}

export async function analyzeGarmentImage(openai: OpenAI, image: GarmentImage) {
  const model = garmentVisionModel();
  const response = await openai.responses.create({
    model,
    instructions: "Analiza solo la prenda principal útil para la consulta comercial. Describe observaciones visuales prudentes. No infieras talla, cuerpo, edad, peso, marca, precio, autenticidad ni composición exacta. Todo material y fit deben indicarse como aparentes. Si hay varias prendas o la imagen es dudosa, regístralo en confidenceNotes. Responde en español.",
    input: [{ role: "user", content: [{ type: "input_text", text: "Extrae los atributos visuales estructurados de la prenda principal." }, { type: "input_image", image_url: image.dataUrl, detail: "auto" }] }],
    text: { format: { type: "json_schema", name: "garment_analysis", strict: true, schema: garmentSchema } },
    store: false,
    max_output_tokens: 700,
  });
  return { analysis: validateGarmentAnalysis(JSON.parse(response.output_text)), usage: response.usage, model };
}

export function validateTemporaryCloset(value: unknown): TemporaryGarment[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) throw new Error("El mini-closet debe contener entre 2 y 4 prendas.");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as Record<string, unknown>).id !== "string") throw new Error("El mini-closet no es válido.");
    return { id: String((entry as Record<string, unknown>).id).slice(0, 40), ...validateGarmentAnalysis(entry) };
  });
}

export async function analyzeGarmentImages(openai: OpenAI, images: GarmentImage[]) {
  const model = garmentVisionModel();
  const itemSchema = { ...garmentSchema, properties: { id: { type: "string" }, ...garmentSchema.properties }, required: ["id", ...garmentSchema.required] };
  const response = await openai.responses.create({
    model,
    instructions: "Analiza por separado cada imagen, en el orden recibido. Devuelve exactamente una prenda por imagen con id garment-1, garment-2, etc. No infieras talla, cuerpo, edad, peso, marca, precio, autenticidad ni composición exacta. Registra toda incertidumbre en confidenceNotes. Responde en español.",
    input: [{ role: "user", content: [{ type: "input_text", text: `Analiza estas ${images.length} imágenes una sola vez y crea el mini-closet estructurado.` }, ...images.map((image) => ({ type: "input_image" as const, image_url: image.dataUrl, detail: "auto" as const }))] }],
    text: { format: { type: "json_schema", name: "temporary_closet", strict: true, schema: { type: "object", additionalProperties: false, properties: { garments: { type: "array", minItems: images.length, maxItems: images.length, items: itemSchema } }, required: ["garments"] } } },
    store: false,
    max_output_tokens: 1800,
  });
  const parsed = JSON.parse(response.output_text) as { garments?: unknown };
  return { garments: validateTemporaryCloset(parsed.garments), usage: response.usage, model };
}
