import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookToken(received: string | null, expected: string) {
  return Boolean(received && expected && safeEqual(received, expected));
}

export function inspectMetaSignature(rawBody: string | Buffer, signature: string | null, secret: string) {
  const prefixValid = signature?.startsWith("sha256=") ?? false;
  const expected = secret ? `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` : "";
  const match = Boolean(signature && expected && prefixValid && safeEqual(signature, expected));
  return {
    match,
    diagnostics: {
      headerPresent: Boolean(signature),
      prefixValid,
      receivedLength: signature?.length ?? 0,
      calculatedLength: expected.length,
      match,
    },
  };
}

export function verifyMetaSignature(rawBody: string | Buffer, signature: string | null, secret: string) {
  return inspectMetaSignature(rawBody, signature, secret).match;
}
