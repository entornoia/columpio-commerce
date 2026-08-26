import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseInstagramWebhook, parseInstagramWebhookWithDiagnostics } from "../src/lib/channels/instagram/parser.ts";
import { verifyMetaSignature, verifyWebhookToken } from "../src/lib/channels/instagram/security.ts";
import { ConversationStore, IdempotencyStore } from "../src/lib/channels/instagram/stores.ts";

const payload = { object: "instagram", entry: [{ messaging: [{ sender: { id: "user-1" }, recipient: { id: "business-1" }, timestamp: 1_700_000_000_000, message: { mid: "mid-1", text: "Busco un blazer negro" } }] }] };

test("normaliza un mensaje válido de Instagram", () => {
  assert.deepEqual(parseInstagramWebhook(payload, "business-1"), [{ channel: "instagram", eventId: "mid-1", externalUserId: "user-1", externalConversationId: "user-1", text: "Busco un blazer negro", imageUrl: null, receivedAt: "2023-11-14T22:13:20.000Z" }]);
});

test("ignora ecos y mensajes enviados por la propia cuenta", () => {
  const echo = structuredClone(payload); echo.entry[0].messaging[0].message.is_echo = true;
  const own = structuredClone(payload); own.entry[0].messaging[0].sender.id = "business-1";
  assert.equal(parseInstagramWebhook(echo, "business-1").length, 0);
  assert.equal(parseInstagramWebhook(own, "business-1").length, 0);
});

test("conserva contexto de historia sin convertirlo en disponibilidad", () => {
  const story = structuredClone(payload);
  story.entry[0].messaging[0].message.reply_to = { story: { id: "story-1", url: "https://lookaside.fbsbx.com/story" } };
  assert.deepEqual(parseInstagramWebhook(story, "business-1")[0].metadata, { storyUrl: "https://lookaside.fbsbx.com/story", storyId: "story-1" });
});

test("identifica explícitamente un evento read real como no procesable", () => {
  const readPayload = { object: "instagram", entry: [{ time: 1_700_000_000, id: "business-1", messaging: [{ read: { mid: "mid-read" } }] }] };
  assert.deepEqual(parseInstagramWebhookWithDiagnostics(readPayload, "business-1"), {
    messages: [],
    ignored: [{ reason: "unsupported_event:read", eventTypes: ["read"] }],
  });
});

test("valida HMAC SHA-256 sobre el cuerpo crudo", () => {
  const raw = JSON.stringify(payload); const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(`${raw} `, signature, secret), false);
});

test("rechaza un verify token incorrecto", () => {
  assert.equal(verifyWebhookToken("correcto", "correcto"), true);
  assert.equal(verifyWebhookToken("incorrecto", "correcto"), false);
  assert.equal(verifyWebhookToken(null, "correcto"), false);
});

test("rechaza eventos duplicados y libera la clave al vencer", () => {
  const store = new IdempotencyStore(100);
  assert.equal(store.claim("mid", 1_000), true);
  assert.equal(store.claim("mid", 1_050), false);
  assert.equal(store.claim("mid", 1_101), true);
  store.release("mid");
  assert.equal(store.claim("mid", 1_102), true);
});

test("aísla contexto por usuario, limita mensajes y aplica TTL", () => {
  const store = new ConversationStore(100);
  store.set("a", { messages: Array.from({ length: 20 }, (_, i) => ({ role: "user", content: String(i) })), garmentAnalysis: null, needsHuman: false }, 1_000);
  store.set("b", { messages: [{ role: "user", content: "otro" }], garmentAnalysis: null, needsHuman: false }, 1_000);
  assert.equal(store.get("a", 1_050).messages.length, 12);
  assert.equal(store.get("b", 1_050).messages[0].content, "otro");
  assert.equal(store.get("a", 1_101).messages.length, 0);
});
