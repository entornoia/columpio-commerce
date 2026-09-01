import { createHmac } from "node:crypto";
import { requirePublicAppOrigin } from "../public-origin.ts";

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

type ExpectedFlowPayment = {
  flowOrder: number;
  commerceOrder: string;
  currency: string;
  amount: number;
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
  readonly providerMessage: string | null;
  constructor(message: string, code: string, uncertain: boolean, httpStatus: number | null = null, providerMessage: string | null = null) {
    super(message); this.code = code; this.uncertain = uncertain; this.httpStatus = httpStatus; this.providerMessage = providerMessage;
  }
}

type SanitizedFlowProviderError = { code: string; message: string | null };
const MAX_PROVIDER_CODE_LENGTH = 100;
const MAX_PROVIDER_MESSAGE_LENGTH = 240;

function sanitizeProviderText(value: unknown, secrets: string[]) {
  if (typeof value !== "string") return null;
  let sanitized = value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(api[_-]?key|secret(?:[_-]?key)?|signature|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[redacted]");
  }
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  return sanitized ? sanitized.slice(0, MAX_PROVIDER_MESSAGE_LENGTH) : null;
}

export function normalizeFlowProviderError(body: unknown, httpStatus: number, secrets: string[] = []): SanitizedFlowProviderError {
  const fallbackCode = `http_${httpStatus}`;
  if (!body || typeof body !== "object" || Array.isArray(body)) return { code: fallbackCode, message: null };
  const row = body as Record<string, unknown>;
  const rawCode = typeof row.code === "string" || (typeof row.code === "number" && Number.isFinite(row.code)) ? String(row.code) : fallbackCode;
  const code = rawCode.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, MAX_PROVIDER_CODE_LENGTH) || fallbackCode;
  const message = sanitizeProviderText(row.message, secrets) ?? sanitizeProviderText(row.error, secrets);
  return { code, message };
}

type FlowConfig = { apiKey: string; secretKey: string; apiBaseUrl: string; appBaseUrl: string };

function operationalConfig(): FlowConfig {
  const apiKey = process.env.FLOW_API_KEY?.trim();
  const secretKey = process.env.FLOW_SECRET_KEY?.trim();
  const environment = process.env.FLOW_ENVIRONMENT?.trim();
  const configuredApiBaseUrl = process.env.FLOW_API_BASE_URL?.trim();
  if (!apiKey) throw new Error("Falta configurar FLOW_API_KEY.");
  if (!secretKey) throw new Error("Falta configurar FLOW_SECRET_KEY.");
  if (environment !== "sandbox" && environment !== "production") throw new Error("FLOW_ENVIRONMENT debe ser sandbox o production.");
  const expectedApiBaseUrl = environment === "sandbox" ? "https://sandbox.flow.cl/api" : "https://www.flow.cl/api";
  if (configuredApiBaseUrl !== expectedApiBaseUrl) throw new Error(`FLOW_API_BASE_URL no corresponde al ambiente ${environment}.`);
  return { apiKey, secretKey, apiBaseUrl: expectedApiBaseUrl, appBaseUrl: requirePublicAppOrigin() };
}

export function assertFlowOperationalConfig() { operationalConfig(); }

export function flowPublicUrl(pathname: `/${string}`) {
  const { appBaseUrl } = operationalConfig();
  return new URL(pathname, appBaseUrl);
}

export function signFlowParameters(parameters: Record<string, string | number>, secretKey: string) {
  const toSign = Object.keys(parameters).sort().map((key) => `${key}${parameters[key]}`).join("");
  return createHmac("sha256", secretKey).update(toSign).digest("hex");
}

export function flowCallbackUrls() {
  return {
    urlConfirmation: flowPublicUrl("/api/payments/flow/confirmation").toString(),
    urlReturn: flowPublicUrl("/api/payments/flow/return").toString(),
  };
}

function strictNonNegativeInteger(value: unknown, field: string) {
  const normalized = typeof value === "number"
    ? value
    : typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new FlowRequestError(`Campo numérico Flow inválido: ${field}.`, "invalid_status_response", true);
  }
  return normalized;
}

export function parseFlowPaymentStatus(value: unknown): FlowPaymentStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FlowRequestError("Respuesta de estado Flow inválida.", "invalid_status_response", true);
  const row = value as Record<string, unknown>;
  const flowOrder = strictNonNegativeInteger(row.flowOrder, "flowOrder");
  const status = strictNonNegativeInteger(row.status, "status");
  const amount = strictNonNegativeInteger(row.amount, "amount");
  if (flowOrder < 1 || typeof row.commerceOrder !== "string" || !row.commerceOrder
    || ![1, 2, 3, 4].includes(status)
    || typeof row.currency !== "string" || !row.currency
    || typeof row.payer !== "string") {
    throw new FlowRequestError("Respuesta de estado Flow incompleta.", "invalid_status_response", true);
  }
  return { flowOrder, commerceOrder: row.commerceOrder, status: status as FlowPaymentStatus["status"], currency: row.currency, amount, payer: row.payer };
}

export function assertFlowPaymentStatusMatches(status: FlowPaymentStatus, expected: ExpectedFlowPayment) {
  if (status.commerceOrder !== expected.commerceOrder || status.flowOrder !== expected.flowOrder
    || status.amount !== expected.amount || status.currency !== expected.currency) {
    throw new Error("Flow payment verification mismatch");
  }
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
    const provider = normalizeFlowProviderError(body, response.status, [config.apiKey, config.secretKey]);
    if (process.env.NODE_ENV === "development") {
      console.warn("[flow] provider request rejected", {
        endpoint: path === "/payment/create" ? "payment/create" : "provider request",
        httpStatus: response.status,
        providerCode: provider.code,
        providerMessage: provider.message,
        orderNumber: typeof parameters.commerceOrder === "string" ? parameters.commerceOrder : null,
      });
    }
    throw new FlowRequestError("Flow rechazó la solicitud.", provider.code, response.status !== 400 && response.status !== 401, response.status, provider.message);
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
      return parseFlowPaymentStatus(await flowRequest("/payment/getStatus", "GET", { apiKey: config.apiKey, token }, config));
    },
    async findByCommerceOrder(commerceOrder) {
      try {
        return parseFlowPaymentStatus(await flowRequest("/payment/getStatusByCommerceId", "GET", { apiKey: config.apiKey, commerceId: commerceOrder }, config));
      } catch (error) {
        if (error instanceof FlowRequestError && !error.uncertain && error.httpStatus === 400) return null;
        throw error;
      }
    },
  };
}
