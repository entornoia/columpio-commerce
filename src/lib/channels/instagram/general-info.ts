export type GeneralInfoTopic = "location" | "hours" | "contact" | "unknown";

export function generalInfoResponse(text: string | null) {
  const normalized = (text ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL");
  const topic: GeneralInfoTopic = /ubicacion|direccion|donde/.test(normalized) ? "location" : /horario|abren|cierran/.test(normalized) ? "hours" : /contacto|correo|email/.test(normalized) ? "contact" : "unknown";
  const configured = topic === "location" ? process.env.INSTAGRAM_STORE_LOCATION : topic === "hours" ? process.env.INSTAGRAM_STORE_HOURS : topic === "contact" ? "costanerasupply@gmail.com" : undefined;
  if (!configured?.trim()) return "No tengo esa información confirmada para darte por aquí. Puedo dejar la consulta para que la revise el equipo.";
  return topic === "location" ? `Estamos en ${configured.trim()}.` : topic === "hours" ? `Nuestro horario es ${configured.trim()}.` : `Puedes escribirnos a ${configured.trim()}.`;
}
