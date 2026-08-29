export function instagramDevLog(event: string, details: Record<string, unknown>, level: "info" | "error" = "info") {
  if (process.env.NODE_ENV !== "development") return;
  const message = `[instagram] ${event} ${JSON.stringify(details)}`;
  if (level === "error") console.error(message); else console.info(message);
}

/** Log operacional apto para producción. El caller debe suministrar solo estados no sensibles. */
export function instagramOperationalLog(event: string, details: Record<string, unknown>, level: "info" | "error" = "info") {
  const message = `[instagram] ${event} ${JSON.stringify(details)}`;
  if (level === "error") console.error(message); else console.info(message);
}
