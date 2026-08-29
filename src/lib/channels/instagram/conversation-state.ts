import type { InstagramIntent } from "./conversation-repository.ts";

export const conversationStates = ["unscoped", "sales", "after_sales", "order_tracking", "human"] as const;
export type InstagramConversationState = (typeof conversationStates)[number];

export const agentQuestions = ["ask_size", "ask_color", "confirm_quantity", "confirm_add", "confirm_order", "ask_email"] as const;
export type InstagramAgentQuestion = (typeof agentQuestions)[number];

export const commercialActions = ["search_catalog", "add_item", "set_quantity", "remove_item", "view_selection", "create_order", "create_payment_link"] as const;
export type InstagramCommercialAction = (typeof commercialActions)[number];

export type InstagramConversationContext = {
  state: InstagramConversationState;
  stateAt: string;
  lastProductId: string | null;
  lastVariantId: string | null;
  lastAgentQuestion: InstagramAgentQuestion | null;
  lastCommercialAction: InstagramCommercialAction | null;
  commercialContextAt: string | null;
};

export type ConversationContextPatch = Partial<Pick<InstagramConversationContext,
  "state" | "lastProductId" | "lastVariantId" | "lastAgentQuestion" | "lastCommercialAction"
>> & { changedAt: string; touchCommercialContext?: boolean };

export function stateForIntent(intent: InstagramIntent): InstagramConversationState | null {
  if (intent === "sales") return "sales";
  if (intent === "exchange_return" || intent === "after_sales") return "after_sales";
  if (intent === "order_tracking") return "order_tracking";
  if (intent === "human_request" || intent === "business_proposal") return "human";
  return null;
}

export function isCommercialContextFresh(context: InstagramConversationContext, receivedAt: string) {
  if (!context.commercialContextAt) return false;
  const elapsed = Date.parse(receivedAt) - Date.parse(context.commercialContextAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 30 * 60_000;
}

export function inferAgentQuestion(response: string): InstagramAgentQuestion | null {
  const normalized = response.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL");
  if (/que talla|cual talla|talla (quieres|buscas|necesitas|prefieres)/.test(normalized)) return "ask_size";
  if (/que color|cual color|color (quieres|buscas|prefieres)/.test(normalized)) return "ask_color";
  if (/quieres dejar solo 1|dejamos solo 1|confirmas.*1 unidad/.test(normalized)) return "confirm_quantity";
  if (/te (lo|la) dejo|quieres que (lo|la) agregue|agregamos/.test(normalized)) return "confirm_add";
  if (/cerramos tu pedido|confirmamos tu pedido|lo cerramos asi/.test(normalized)) return "confirm_order";
  if (/necesito tu correo|me compartes.*correo/.test(normalized)) return "ask_email";
  return null;
}
