/** Modelo único del agente MVP. Cambiarlo aquí actualiza toda la integración. */
export const SELLER_AGENT_MODEL = "gpt-5.4-mini";
export const INTENT_ROUTER_MODEL = "gpt-5.4-mini";
export const DEFAULT_GARMENT_VISION_MODEL = "gpt-5.4-mini";
export const SUPPORTED_GARMENT_VISION_MODELS = ["gpt-5.4-mini", "gpt-5.4-nano"] as const;
export const MAX_CONVERSATION_MESSAGES = 12;
export const MAX_TOOL_ROUNDS = 6;
export const MAX_GARMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_GARMENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_TEMPORARY_CLOSET_SIZE = 4;

export function multiGarmentStylingEnabled() { return process.env.ENABLE_MULTI_GARMENT_STYLING === "true"; }
export function garmentVisionModel(): typeof SUPPORTED_GARMENT_VISION_MODELS[number] {
  const configured = process.env.GARMENT_VISION_MODEL;
  return SUPPORTED_GARMENT_VISION_MODELS.includes(configured as never) ? configured as typeof SUPPORTED_GARMENT_VISION_MODELS[number] : DEFAULT_GARMENT_VISION_MODEL;
}
