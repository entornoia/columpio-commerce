import type { InstagramIntent } from "./conversation-repository";

export const PAUSE_INTENTS = new Set<InstagramIntent>(["human_request", "after_sales", "exchange_return", "order_tracking", "business_proposal"]);
export const GREETING_RESPONSE = "Hola 💛 ¿En qué te puedo ayudar hoy?";
export const EXCHANGE_CLARIFICATION_RESPONSE = "Claro. ¿La blusa ya la tienes contigo y quieres hacer un cambio de una compra/regalo, o quieres modificar algo de tu carrito?";

export function safeIntentResponse(intent: InstagramIntent, secondUnknown = false) {
  if (intent === "human_request") return "Por supuesto. Dejé la conversación en modo humano para que pueda continuar una persona del equipo.";
  if (intent === "after_sales") return "Para revisar bien tu caso necesito dejarlo con una persona del equipo. Te responderán por esta conversación.";
  if (intent === "exchange_return") return "Entiendo. Como se trata de un cambio de una prenda que ya tienes, voy a dejar la conversación con una persona del equipo para que te indique cómo hacerlo.";
  if (intent === "order_tracking") return "Voy a dejar el seguimiento con una persona del equipo para que revise el estado real de tu pedido.";
  if (intent === "business_proposal") return "Gracias por escribirnos. Voy a dejar tu propuesta para que la revise una persona del equipo.";
  if (intent === "unknown") return secondUnknown ? "Voy a dejar tu consulta con una persona del equipo para que pueda orientarte mejor." : "¿Tu consulta es por un producto, una compra que ya hiciste o necesitas hablar con una persona?";
  throw new Error(`No existe respuesta segura para ${intent}.`);
}
