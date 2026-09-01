function isPrivateHostname(hostname: string) {
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  const privateIpv4 = Boolean(ipv4 && (
    ipv4.some((part) => part > 255)
    || ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127
    || (ipv4[0] === 169 && ipv4[1] === 254)
    || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168)
  ));
  const privateIpv6 = /^\[(?:::1|f[cd][0-9a-f]{0,2}:|fe[89ab][0-9a-f]?:)/.test(hostname);
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || privateIpv4
    || privateIpv6;
}

export function publicAppOrigin(value = process.env.APP_BASE_URL) {
  const configured = value?.trim();
  if (!configured) return null;
  const parsed = new URL(configured);
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || isPrivateHostname(hostname)
  ) {
    throw new Error("APP_BASE_URL debe ser un origen HTTPS público, sin credenciales, query ni fragmento.");
  }
  return parsed.origin;
}

export function requirePublicAppOrigin() {
  const origin = publicAppOrigin();
  if (!origin) throw new Error("Falta configurar APP_BASE_URL.");
  return origin;
}

export function usesSecurePublicCookies(
  nodeEnv = process.env.NODE_ENV,
  value = process.env.APP_BASE_URL,
) {
  return nodeEnv === "production" || publicAppOrigin(value) !== null;
}

export function assertTrustedRequestOrigin(
  request: Request,
  configuredPublicOrigin: string | null = publicAppOrigin(),
) {
  const origin = request.headers.get("origin");
  if (!origin) throw new Error("Origen no permitido.");
  const allowedOrigins = new Set([new URL(request.url).origin]);
  if (configuredPublicOrigin) allowedOrigins.add(configuredPublicOrigin);
  if (!allowedOrigins.has(origin)) throw new Error("Origen no permitido.");
}
