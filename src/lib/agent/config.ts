/** Modelo único del agente MVP. Cambiarlo aquí actualiza toda la integración. */
export const SELLER_AGENT_MODEL = "gpt-5.4-mini";
export const MAX_CONVERSATION_MESSAGES = 12;
export const MAX_TOOL_ROUNDS = 6;
export const MAX_GARMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_GARMENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
