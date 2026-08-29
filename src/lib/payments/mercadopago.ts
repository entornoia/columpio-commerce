export type MercadoPagoPreferenceItem = {
  id: string;
  title: string;
  description: string;
  currency_id: "CLP";
  quantity: number;
  unit_price: number;
};

export type MercadoPagoPreferencePayload = {
  items: MercadoPagoPreferenceItem[];
  statement_descriptor: "COLUMPIO";
  external_reference: string;
  metadata: { order_id: string; order_number: string; channel: "instagram" };
  back_urls: { success: string; pending: string; failure: string };
  auto_return: "approved";
};

export type MercadoPagoPreference = {
  id: string;
  initPoint: string;
  sandboxInitPoint: string | null;
};

export type MercadoPagoGateway = {
  createPreference(payload: MercadoPagoPreferencePayload): Promise<MercadoPagoPreference>;
  findPreference(externalReference: string): Promise<MercadoPagoPreference | null>;
};

export class MercadoPagoRequestError extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  constructor(message: string, code: string, uncertain: boolean) { super(message); this.code = code; this.uncertain = uncertain; }
}

function config() {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const environment = process.env.MERCADOPAGO_ENVIRONMENT;
  const baseUrl = process.env.APP_BASE_URL;
  if (!accessToken) throw new Error("Falta configurar MERCADOPAGO_ACCESS_TOKEN.");
  if (environment !== "test" && environment !== "production") throw new Error("MERCADOPAGO_ENVIRONMENT debe ser test o production.");
  if (!baseUrl) throw new Error("Falta configurar APP_BASE_URL.");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") throw new Error("APP_BASE_URL debe ser una URL HTTPS.");
  return { accessToken, baseUrl: parsed.origin };
}

export function assertMercadoPagoOperationalConfig() { config(); }

function preference(value: unknown): MercadoPagoPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MercadoPagoRequestError("Respuesta inválida de Mercado Pago.", "invalid_response", true);
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id || typeof record.init_point !== "string" || !record.init_point) throw new MercadoPagoRequestError("Respuesta incompleta de Mercado Pago.", "invalid_response", true);
  const initPoint = new URL(record.init_point);
  if (initPoint.protocol !== "https:") throw new MercadoPagoRequestError("Mercado Pago devolvió una URL inválida.", "invalid_url", true);
  let sandboxInitPoint: string | null = null;
  if (typeof record.sandbox_init_point === "string" && record.sandbox_init_point) {
    const sandboxUrl = new URL(record.sandbox_init_point);
    if (sandboxUrl.protocol !== "https:") throw new MercadoPagoRequestError("Mercado Pago devolvió una URL sandbox inválida.", "invalid_url", true);
    sandboxInitPoint = record.sandbox_init_point;
  }
  return { id: record.id, initPoint: record.init_point, sandboxInitPoint };
}

async function request(url: string, init: RequestInit, accessToken: string) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers }, signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new MercadoPagoRequestError("No se pudo confirmar la respuesta de Mercado Pago.", "network_error", true);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const code = typeof record.error === "string" ? record.error : `http_${response.status}`;
    throw new MercadoPagoRequestError("Mercado Pago rechazó la solicitud.", code, response.status >= 500 || response.status === 429);
  }
  return body;
}

export function createMercadoPagoGateway(): MercadoPagoGateway {
  const { accessToken } = config();
  return {
    async createPreference(payload) {
      const body = await request("https://api.mercadopago.com/checkout/preferences", { method: "POST", body: JSON.stringify(payload) }, accessToken);
      return preference(body);
    },
    async findPreference(externalReference) {
      const url = new URL("https://api.mercadopago.com/checkout/preferences/search");
      url.searchParams.set("external_reference", externalReference);
      url.searchParams.set("limit", "10");
      const body = await request(url.toString(), { method: "GET" }, accessToken);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new MercadoPagoRequestError("Respuesta de búsqueda inválida.", "invalid_search_response", true);
      const elements = (body as Record<string, unknown>).elements;
      if (!Array.isArray(elements)) throw new MercadoPagoRequestError("Respuesta de búsqueda incompleta.", "invalid_search_response", true);
      const match = elements.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).external_reference === externalReference);
      return match ? preference(match) : null;
    },
  };
}

export function mercadoPagoReturnUrls() {
  const { baseUrl } = config();
  return {
    success: `${baseUrl}/payment-result?result=success`,
    pending: `${baseUrl}/payment-result?result=pending`,
    failure: `${baseUrl}/payment-result?result=failure`,
  };
}
