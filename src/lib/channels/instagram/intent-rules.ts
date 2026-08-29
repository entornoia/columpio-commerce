import type { InstagramIntent, InstagramIntentState } from "./conversation-repository";
import type { IncomingCommerceMessage } from "./types";

export type IntentClassification = { intent: InstagramIntent; confidence: number; reason: string; source: "rule" | "llm" | "fallback" };
export const GREETING_REASON = "Saludo sin otra intención";
export const AMBIGUOUS_EXCHANGE_REASON = "Cambio sin contexto confirmado de posesión";
export const COMMERCIAL_CONTINUATION_REASON = "Confirmación elíptica sin contexto comercial reciente";

const result = (intent: InstagramIntent, reason: string): IntentClassification => ({ intent, confidence: 0.99, reason, source: "rule" });
const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL").trim();

export function intentRuleFeatures(value: string | null) {
  const text = normalize(value ?? "");
  return {
    hasChangeSignal: /\b(cambio|cambiar|cambiarlo|cambiarla|cambiarme|cambiarmelo|cambiarmela|cambie|devolucion|devolver|devolverlo|devolverla)\b/.test(text),
    hasGiftSignal: /\b(regalo|regalaron|me (la |lo )?regalaron|fue un regalo)\b/.test(text),
    hasCartSignal: /\b(carrito|antes de (comprar|confirmar)|pedido (aun|todavia) no confirmado)\b/.test(text),
  };
}

export function isPureSocialReaction(text: string | null) {
  if (!text) return false;
  const withoutEmoji = text.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|[\s!?.,¡¿]/gu, "");
  return withoutEmoji.length === 0 && /\p{Extended_Pictographic}/u.test(text);
}

function recentSalesContext(state: InstagramIntentState, now: number) {
  if (state.lastIntent !== "sales" || !state.lastIntentAt) return false;
  const timestamp = Date.parse(state.lastIntentAt);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= 30 * 60_000;
}

function hasPostPurchaseSignal(text: string) {
  return /\b(me (la |lo )?regalaron|fue un regalo|compre|compramos|recibi|me llego|uno que tengo|una que tengo|ya (la|lo) tengo|tengo (la|el|esta|este|una|un) (prenda|pieza|blazer|chaqueta|pantalon|blusa|vestido|emilia)|no (la|lo) he usado|me quedo (grande|chic[oa]|pequen[oa])|me queda (grande|chic[oa]|pequen[oa])|quiero devolver(lo|la)?|devolver (la|el|una|un) (prenda|pieza))\b/.test(text);
}

function hasChangeSignal(text: string) {
  return /\b(cambio|cambia|cambiar|cambiarlo|cambiarla|cambiarme|cambiarmelo|cambiarmela|cambie|devolucion|devolver|devolverlo|devolverla)\b/.test(text);
}

function isPrepurchaseChange(text: string) {
  return /\b(carrito|color del look|antes de (comprar|confirmar)|antes de confirmar el pedido|todavia no (compro|he comprado)|aun no (compro|he comprado)|quita (este|esta|eso|esa) y agrega)\b/.test(text);
}

function isGreeting(text: string) {
  const compact = text.replace(/[!?.,]+$/g, "").trim();
  return /^(hola+|buenas|buenos dias|buen dia|buenas tardes|buenas noches|como estan|como estas)$/.test(compact);
}

function hasExplicitSalesSearch(text: string) {
  const searchLanguage = /\b(estoy buscando|ando buscando|busco|buscar|necesito|quiero|tienes|tienen)\b/.test(text);
  const commercialSubject = /\b(prenda|pieza|blazer(?:es)?|chaquetas?|pantalon(?:es)?|blusas?|vestidos?|faldas?|poleras?|talla|colores?|negro|negra|marfil|camel|fiesta|evento|look)\b/.test(text);
  const contextualSomething = /\b(estoy buscando|ando buscando|busco|tienes|tienen)\s+algo\b/.test(text)
    && /\b(negro|negra|marfil|camel|fiesta|evento|look|vestir|usar)\b/.test(text);
  return (searchLanguage && commercialSubject) || contextualSomething;
}

export function classifyIntentByRules(message: IncomingCommerceMessage, state: InstagramIntentState, now = Date.parse(message.receivedAt)): IntentClassification | null {
  const text = normalize(message.text ?? "");
  const isEmailReply = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  const isCommercialEllipsis = /^(m|s|l|xl|xxl|talla\s+(m|s|l|xl|xxl)|ese|esa|el negro|la negra|si|si,? dos|si por favor|por favor|dale|ok|bueno|perfecto|hazlo|muestrame|dos|agregalo|agregala|mandame el link)$/.test(text);
  if (/\b(hablar|comunicarme|contactarme)\s+con\s+(una\s+)?(persona|humana?|ejecutiv[oa]|asesora)|\b(estoy buscando|busco|necesito|quiero)\s+(a\s+)?(una\s+)?persona\s+(que\s+)?(me\s+)?(atienda|ayude)?|\b(no quiero|sin)\s+(un\s+)?bot\b|\batencion humana\b/.test(text)) return result("human_request", "Solicitud explícita de atención humana");
  if (isGreeting(text)) return result("general_info", GREETING_REASON);
  if (/\b(donde esta mi pedido|cuando llega|cuando llegara|ya pague|estado de mi (compra|pedido)|seguimiento (de|del|a mi) pedido|me llego el pedido)\b/.test(text)) return result("order_tracking", "Seguimiento de una compra o pago ya realizado");
  if (/\b(garantia|defectuos[oa]|danad[oa]|roto|reclamo|reembolso|cobro duplicado|no (ha )?llegado|seguimiento (de|del) pedido|problema con (mi|una) compra)\b/.test(text)) return result("after_sales", "Consulta posterior a una compra");
  if (hasPostPurchaseSignal(text)) return result("exchange_return", "Solicitud de cambio o devolución posterior a la compra");
  if (hasChangeSignal(text) && !isPrepurchaseChange(text)) return result("unknown", AMBIGUOUS_EXCHANGE_REASON);
  if (/\b(community manager|manejo de redes|servicios? de (marketing|fotografia|redes)|propuesta comercial|proveedor|colaboracion comercial|embajador[oa]|influencer)\b/.test(text)) return result("business_proposal", "Oferta de servicios o colaboración comercial");
  if (hasExplicitSalesSearch(text)) return result("sales", "Búsqueda explícita de producto o necesidad de compra");
  if (isEmailReply) return recentSalesContext(state, now)
    ? result("sales", "Correo entregado como continuación comercial reciente")
    : result("unknown", COMMERCIAL_CONTINUATION_REASON);
  if (isCommercialEllipsis) return recentSalesContext(state, now)
    ? result("sales", "Continuación elíptica de contexto comercial reciente")
    : result("unknown", COMMERCIAL_CONTINUATION_REASON);
  if (/\b(precio|valor|cuanto (sale|cuesta)|stock|disponib|tienes|tienen|talla|color|look|blazers?|chaquetas?|pantalon(?:es)?|blusas?|vestidos?|sku|carrito|quitar|pedido|pagar|pago|link de pago|recomiend|combinar)\b/.test(text)) return result("sales", "Consulta o acción comercial");
  if (/\b(donde (estan|queda|se ubican)|ubicacion|direccion|horario|cuando abren|contacto|correo|email)\b/.test(text)) return result("general_info", "Consulta de información general");
  if (isPureSocialReaction(message.text)) return result("social_reaction", "Reacción social sin texto útil");
  if (!message.text && message.imageUrl) return result("sales", "Imagen enviada para consulta o recomendación comercial");
  return null;
}
