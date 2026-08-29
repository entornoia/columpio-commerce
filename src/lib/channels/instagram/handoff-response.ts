import type { HandoffReason } from "./handoff-cases";

function configuredSlaHours() {
  const raw = process.env.HUMAN_HANDOFF_SLA_HOURS;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 168 ? value : null;
}

function timingSentence() {
  const hours = configuredSlaHours();
  return hours
    ? `Te contactaremos por este mismo chat dentro de las próximas ${hours} horas para ayudarte a gestionarlo.`
    : "Te contactaremos por este mismo chat para ayudarte a gestionarlo.";
}

export function handoffAcknowledgement(reason: HandoffReason) {
  const timing = timingSentence();
  if (reason === "exchange_return") return `Entiendo 💛 Como se trata de un cambio de una prenda que ya tienes, voy a dejar tu caso con una persona del equipo. ${timing}`;
  if (reason === "after_sales") return `Entiendo 💛 Como tu consulta requiere revisar una compra, voy a dejar tu caso con una persona del equipo. ${timing}`;
  if (reason === "business_proposal") return `Gracias por escribirnos. Voy a dejar tu propuesta con una persona del equipo para que pueda revisarla. ${timing}`;
  if (reason === "human_request") return `Por supuesto. Voy a dejar esta conversación con una persona del equipo. ${timing}`;
  return `Voy a dejar tu consulta con una persona del equipo para que pueda orientarte mejor. ${timing}`;
}
