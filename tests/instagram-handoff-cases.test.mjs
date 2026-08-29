import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { automationModeValues } from "../src/lib/channels/instagram/conversation-repository.ts";
import { handoffAcknowledgement } from "../src/lib/channels/instagram/handoff-response.ts";
import { sendHandoffNotification } from "../src/lib/channels/instagram/handoff-notification.ts";

test("010 crea casos sin mensajes, transición atómica e idempotencia persistente", async () => {
  const sql = await readFile(new URL("../supabase/migrations/010_instagram_handoff_cases.sql", import.meta.url), "utf8");
  assert.match(sql, /unique index if not exists instagram_handoff_cases_trigger_event_idx/i);
  assert.match(sql, /unique index if not exists instagram_handoff_cases_one_open_idx[\s\S]*where status in \('pending', 'in_progress'\)/i);
  assert.match(sql, /update public\.instagram_conversations[\s\S]*agent_enabled = false[\s\S]*human_only = false[\s\S]*insert into public\.instagram_handoff_cases/i);
  assert.match(sql, /c\.agent_enabled = true[\s\S]*c\.human_only = false/i);
  assert.match(sql, /security invoker/i);
  assert.doesNotMatch(sql, /message_text|message_content|message_body|history/i);
});

test("acuse usa SLA válido y omite plazo específico si falta o es inválido", () => {
  const previous = process.env.HUMAN_HANDOFF_SLA_HOURS;
  try {
    process.env.HUMAN_HANDOFF_SLA_HOURS = "24";
    assert.equal(handoffAcknowledgement("exchange_return"), "Entiendo 💛 Como se trata de un cambio de una prenda que ya tienes, voy a dejar tu caso con una persona del equipo. Te contactaremos por este mismo chat dentro de las próximas 24 horas para ayudarte a gestionarlo.");
    delete process.env.HUMAN_HANDOFF_SLA_HOURS;
    assert.doesNotMatch(handoffAcknowledgement("exchange_return"), /próximas \d+ horas/);
    process.env.HUMAN_HANDOFF_SLA_HOURS = "mañana";
    assert.doesNotMatch(handoffAcknowledgement("human_request"), /próximas \d+ horas/);
  } finally { if (previous === undefined) delete process.env.HUMAN_HANDOFF_SLA_HOURS; else process.env.HUMAN_HANDOFF_SLA_HOURS = previous; }
});

test("todas las causas tienen acuse determinista sin políticas inventadas", () => {
  for (const reason of ["exchange_return", "after_sales", "order_tracking", "business_proposal", "human_request", "unknown_escalation"]) {
    const response = handoffAcknowledgement(reason);
    assert.ok(response.length > 30); assert.doesNotMatch(response, /garantía de \d|días para cambiar|reembolso/i);
  }
});

test("email no configurado o fallido nunca interrumpe el handoff", async () => {
  const oldTo = process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL; const oldFrom = process.env.HUMAN_HANDOFF_EMAIL_FROM;
  const data = { caseId: "case-1", reason: "exchange_return", instagramUsername: "cliente", maskedInstagramId: "2801••••4721", createdAt: new Date().toISOString() };
  try {
    delete process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL; delete process.env.HUMAN_HANDOFF_EMAIL_FROM;
    assert.deepEqual(await sendHandoffNotification(data), { status: "not_configured", providerId: null });
    process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL = "equipo@example.test"; process.env.HUMAN_HANDOFF_EMAIL_FROM = "Columpio <no-reply@example.test>";
    assert.deepEqual(await sendHandoffNotification(data, async () => { throw new Error("provider unavailable"); }), { status: "failed", providerId: null });
  } finally {
    if (oldTo === undefined) delete process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL; else process.env.HUMAN_HANDOFF_NOTIFICATION_EMAIL = oldTo;
    if (oldFrom === undefined) delete process.env.HUMAN_HANDOFF_EMAIL_FROM; else process.env.HUMAN_HANDOFF_EMAIL_FROM = oldFrom;
  }
});

test("processor notifica una sola vez únicamente cuando gana la transición", async () => {
  const processor = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  assert.match(processor, /if \(transition\.transitioned && transition\.caseId\) \{[\s\S]*sendHandoffNotification\([\s\S]*updateHandoffNotification/);
  assert.equal(processor.match(/await sendHandoffNotification\(/g)?.length, 1);
});

test("tomar y resolver no reactivan; Volver al agente respeta human_only", async () => {
  const casesSource = await readFile(new URL("../src/lib/channels/instagram/handoff-cases.ts", import.meta.url), "utf8");
  const repositorySource = await readFile(new URL("../src/lib/channels/instagram/conversation-repository.ts", import.meta.url), "utf8");
  assert.match(casesSource, /action === "take"[\s\S]*status: "in_progress"[\s\S]*acknowledged_at/);
  assert.match(casesSource, /status: "resolved"[\s\S]*resolved_at/);
  assert.doesNotMatch(casesSource, /instagram_conversations|agent_enabled/);
  assert.match(repositorySource, /if \(mode === "agent"\) query = query\.eq\("human_only", false\)/);
  assert.match(repositorySource, /primero debes resolver el caso abierto/);
  assert.equal(automationModeValues("agent").agent_enabled, true);
  assert.equal(automationModeValues("temporary_human").agent_enabled, false);
});

test("API administrativa limita acciones y dashboard muestra operación requerida", async () => {
  const route = await readFile(new URL("../src/app/api/instagram/handoff-cases/[id]/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/instagram-conversations/page.tsx", import.meta.url), "utf8");
  const repository = await readFile(new URL("../src/lib/channels/instagram/conversation-repository.ts", import.meta.url), "utf8");
  assert.match(route, /getAdministrativeSession/); assert.match(route, /if \(!authorized\)/); assert.match(route, /new Set\(\["take", "resolve"\]\)/);
  for (const label of ["Tomar caso", "Marcar resuelto", "Volver al agente", "Siempre humano"]) assert.match(page, new RegExp(label));
  assert.match(repository, /pending: 0, in_progress: 1, resolved: 2/); assert.match(page, /IGSID:/); assert.match(page, /caseAge/);
});
