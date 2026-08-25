import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookToken(received: string | null, expected: string) {
  return Boolean(received && expected && safeEqual(received, expected));
}

export function verifyMetaSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
  return safeEqual(signature, expected);
}
