import { createHmac } from "node:crypto";

export type FlowCreatePaymentPayload = {
  commerceOrder: string;
  subject: string;
  currency: "CLP";
  amount: number;
  email: string;
  paymentMethod: 9;
  urlConfirmation: string;
  urlReturn: string;
  optional: string;
};

export type FlowCheckout = { flowOrder: number; token: string; paymentUrl: string };
export type FlowPaymentStatus = {
  flowOrder: number; commerceOrder: string; status: 1 | 2 | 3 | 4;
  currency: string; amount: number; payer: string;
};

export type FlowGateway = {
  createPayment(payload: FlowCreatePaymentPayload): Promise<FlowCheckout>;
  getStatus(token: string): Promise<FlowPaymentStatus>;
  findByCommerceOrder(commerceOrder: string): Promise<FlowPaymentStatus | null>;
};

export class FlowRequestError extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  readonly httpStatus: number | null;
  constructor(message: string, code: string, uncertain: boolean, httpStatus: number | null = null) {
    super(message); this.code = code; this.uncertain = uncertain; this.httpStatus = httpStatus;
  }
}

type FlowConfig = { apiKey: string; secretKey: string; apiBaseUrl: string; appBaseUrl: string };

function operationalConfig(): FlowConfig {
  const apiKey = process.env.FLOW_API_KEY?.trim();
  const secretKey = process.env.FLOW_SECRET_KEY?.trim();
  const environment = process.env.FLOW_ENVIRONMENT?.trim();
  const configuredApiBaseUrl = process.env.FLOW_API_BASE_URL?.trim();
  const configuredAppBaseUrl = process.env.APP_BASE_URL?.trim();
  if (!apiKey) throw new Error("Falta configurar FLOW_API_KEY.");
  if (!secretKey) throw new Error("Falta configurar FLOW_SECRET_KEY.");
  if (environment !== "sandbox" && environment !== "production") throw new Error("FLOW_ENVIRONMENT debe ser sandbox o production.");
  const expectedApiBaseUrl = environment === "sandbox" ? "https://sandbox.flow.cl/api" : "https://www.flow.cl/api";
  if (configuredApiBaseUrl !== expectedApiBaseUrl) throw new Error(`FLOW_API_BASE_URL no corresponde al ambiente ${environment}.`);
  if (!configuredAppBaseUrl) throw new Error("Falta configurar APP_BASE_URL.");
  const appBaseUrl = new URL(configuredAppBaseUrl);
  if (appBaseUrl.protocol !== "https:" || appBaseUrl.username || appBaseUrl.password || appBaseUrl.pathname !== "/" || appBaseUrl.search || appBaseUrl.hash) {
    throw new Error("APP_BASE_URL debe ser un origen HTTPS sin credenciales, query ni fragmento.");
  }
  return { apiKey, secretKey, apiBaseUrl: expectedApiBaseUrl, appBaseUrl: appBaseUrl.origin };
}

export function assertFlowOperationalConfig() { operationalConfig(); }

export function signFlowParameters(parameters: Record<string, string | number>, secretKey: string) {
  const toSign = Object.keys(parameters).sort().map((key) => `${key}${parameters[key]}`).join("");
  return createHmac("sha256", secretKey).update(toSign).digest("hex");
}

export function flowCallbackUrls() {
  const { appBaseUrl } = operationalConfig();
  return {
    urlConfirmation: `${appBaseUrl}/api/payments/flow/confirmation`,
    urlReturn: `${appBaseUrl}/api/payments/flow/return`,
  };
}

function parseStatus(value: unknown): FlowPaymentStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FlowRequestError("Respuesta de estado Flow inválida.", "invalid_status_response", true);
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.flowOrder) || (row.flowOrder as number) < 1
    || typeof row.commerceOrder !== "string" || !row.commerceOrder
    || ![1, 2, 3, 4].includes(row.status as number)
    || typeof row.currency !== "string" || typeof row.amount !== "number"
    || typeof row.payer !== "string") {
    throw new FlowRequestError("Respuesta de estado Flow incompleta.", "invalid_status_response", true);
  }
  return row as unknown as FlowPaymentStatus;
}

function parseCheckout(value: unknown): FlowCheckout {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FlowRequestError("Respuesta Flow inválida.", "invalid_response", true);
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.flowOrder) || (row.flowOrder as number) < 1
    || typeof row.url !== "string" || !row.url
    || typeof row.token !== "string" || !/^[A-Za-z0-9_-]+$/.test(row.token)) {
    throw new FlowRequestError("Respuesta Flow incompleta.", "invalid_response", true);
  }
  assertFlowPaymentUrl(row.url);
  return { flowOrder: row.flowOrder as number, token: row.token, paymentUrl: `${row.url}?token=${row.token}` };
}

export function assertFlowPaymentUrl(value: unknown) {
  if (typeof value !== "string" || !value) throw new FlowRequestError("URL Flow inválida.", "invalid_url", false);
  const url = new URL(value);
  if (url.protocol !== "https:" || !(url.hostname === "flow.cl" || url.hostname.endsWith(".flow.cl")) || url.username || url.password || url.hash) {
    throw new FlowRequestError("Flow devolvió una URL de pago inválida.", "invalid_url", true);
  }
  return url;
}

async function flowRequest(path: string, method: "GET" | "POST", parameters: Record<string, string | number>, config: FlowConfig) {
  const signed = { ...parameters, s: signFlowParameters(parameters, config.secretKey) };
  const url = new URL(`${config.apiBaseUrl}${path}`);
  let init: RequestInit;
  if (method === "GET") {
    for (const [key, value] of Object.entries(signed)) url.searchParams.set(key, String(value));
    init = { method, signal: AbortSignal.timeout(12_000) };
  } else {
    init = {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(signed).map(([key, value]) => [key, String(value)])).toString(),
      signal: AbortSignal.timeout(12_000),
    };
  }

  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new FlowRequestError("No se pudo confirmar la respuesta de Flow.", "network_error", true); }

  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const code = body && typeof body === "object" && !Array.isArray(body) && typeof (body as Record<string, unknown>).code === "string"
      ? String((body as Record<string, unknown>).code) : `http_${response.status}`;
    throw new FlowRequestError("Flow rechazó la solicitud.", code, response.status !== 400 && response.status !== 401, response.status);
  }
  return body;
}

export function createFlowGateway(): FlowGateway {
  const config = operationalConfig();
  return {
    async createPayment(payload) {
      return parseCheckout(await flowRequest("/payment/create", "POST", { apiKey: config.apiKey, ...payload }, config));
    },
    async getStatus(token) {
      if (!token) throw new FlowRequestError("Token Flow inválido.", "invalid_token", false);
      return parseStatus(await flowRequest("/payment/getStatus", "GET", { apiKey: config.apiKey, token }, config));
    },
    async findByCommerceOrder(commerceOrder) {
      try {
        return parseStatus(await flowRequest("/payment/getStatusByCommerceId", "GET", { apiKey: config.apiKey, commerceId: commerceOrder }, config));
      } catch (error) {
        if (error instanceof FlowRequestError && !error.uncertain && error.httpStatus === 400) return null;
        throw error;
      }
    },
  };
}
