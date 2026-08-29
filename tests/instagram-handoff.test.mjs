import assert from "node:assert/strict";
import test from "node:test";
import { automationModeValues } from "../src/lib/channels/instagram/conversation-repository.ts";
import { isInstagramAgentGloballyEnabled, runWithConversationHandoff } from "../src/lib/channels/instagram/handoff.ts";

const message = { channel: "instagram", externalUserId: "user-1", eventId: "mid-1", receivedAt: "2026-08-26T12:00:00.000Z" };
const active = { agentEnabled: true, humanOnly: false };
const temporaryHuman = { agentEnabled: false, humanOnly: false };
const alwaysHuman = { agentEnabled: false, humanOnly: true };

process.env.INSTAGRAM_AGENT_ENABLED = "true";

function memoryControl(initial = {}, durableStates = new Map(Object.entries(initial))) {
  let registrations = 0;
  return {
    states: durableStates,
    get registrations() { return registrations; },
    control: {
      async registerIncoming(value) { registrations += 1; if (!durableStates.has(value.externalUserId)) durableStates.set(value.externalUserId, { ...active }); },
      async getAutomationState(_channel, externalUserId) {
        const state = durableStates.get(externalUserId);
        if (!state) throw new Error("missing state");
        return { ...state };
      },
    },
  };
}

test("una conversación nueva queda activa y responde", async () => {
  const memory = memoryControl(); let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, globalEnabled: () => true, generate: async () => "respuesta", send: async () => { sent += 1; } });
  assert.deepEqual(memory.states.get("user-1"), active); assert.equal(outcome.status, "sent"); assert.equal(sent, 1);
});

test("registrar un mensaje no reactiva una pausa temporal", async () => {
  const memory = memoryControl({ "user-1": temporaryHuman });
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => "respuesta", send: async () => undefined });
  assert.deepEqual(memory.states.get("user-1"), temporaryHuman); assert.deepEqual(outcome, { status: "paused", reason: "temporary_human" });
});

test("un mensaje pausado no ejecuta agente, búsqueda ni Send API", async () => {
  const memory = memoryControl({ "user-1": temporaryHuman }); let agentCalls = 0; let searchCalls = 0; let sendCalls = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => { agentCalls += 1; searchCalls += 1; return "respuesta"; }, send: async () => { sendCalls += 1; } });
  assert.equal(outcome.status, "paused"); assert.deepEqual({ agentCalls, searchCalls, sendCalls }, { agentCalls: 0, searchCalls: 0, sendCalls: 0 });
});

test("una conversación reactivada vuelve a responder", async () => {
  const memory = memoryControl({ "user-1": temporaryHuman }); memory.states.set("user-1", { ...active }); let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => "respuesta", send: async () => { sent += 1; } });
  assert.equal(outcome.status, "sent"); assert.equal(sent, 1);
});

test("una pausa durante el procesamiento impide el envío final", async () => {
  const memory = memoryControl({ "user-1": active }); let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => { memory.states.set("user-1", { ...temporaryHuman }); return "respuesta"; }, send: async () => { sent += 1; } });
  assert.deepEqual(outcome, { status: "paused", reason: "temporary_human" }); assert.equal(sent, 0);
});

test("human_only nunca ejecuta agente, búsqueda ni Send API", async () => {
  const memory = memoryControl({ "user-1": alwaysHuman }); let agentCalls = 0; let searchCalls = 0; let sendCalls = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => { agentCalls += 1; searchCalls += 1; return "respuesta"; }, send: async () => { sendCalls += 1; } });
  assert.deepEqual(outcome, { status: "paused", reason: "human_only" }); assert.deepEqual({ agentCalls, searchCalls, sendCalls }, { agentCalls: 0, searchCalls: 0, sendCalls: 0 });
});

test("recibir mensajes nuevos no modifica human_only", async () => {
  const memory = memoryControl({ "user-1": alwaysHuman });
  await memory.control.registerIncoming({ ...message, eventId: "mid-2" });
  assert.deepEqual(memory.states.get("user-1"), alwaysHuman);
});

test("una nueva instancia conserva el estado human_only persistido", async () => {
  const durable = new Map([["user-1", { ...alwaysHuman }]]);
  const firstInstance = memoryControl({}, durable); await firstInstance.control.registerIncoming(message);
  const restartedInstance = memoryControl({}, durable);
  assert.deepEqual(await restartedInstance.control.getAutomationState("instagram", "user-1"), alwaysHuman);
});

test("Volver al agente restaura explícitamente ambos flags", () => {
  assert.deepEqual(automationModeValues("agent", "2026-08-26T13:00:00.000Z"), { agent_enabled: true, human_only: false, human_takeover_at: null, conversation_state: "unscoped", conversation_state_at: "2026-08-26T13:00:00.000Z", last_product_id: null, last_variant_id: null, last_agent_question: null, last_commercial_action: null, commercial_context_at: null, focus_product_id: null, focus_variant_id: null, focus_category: null, focus_updated_at: null, updated_at: "2026-08-26T13:00:00.000Z" });
});

test("Siempre humano desactiva también agent_enabled", () => {
  assert.deepEqual(automationModeValues("human_only", "2026-08-26T13:00:00.000Z"), { agent_enabled: false, human_only: true, human_takeover_at: "2026-08-26T13:00:00.000Z", conversation_state: "human", conversation_state_at: "2026-08-26T13:00:00.000Z", updated_at: "2026-08-26T13:00:00.000Z" });
});

test("human_only tiene prioridad incluso si agent_enabled es true", async () => {
  const memory = memoryControl({ "user-1": { agentEnabled: true, humanOnly: true } });
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => "respuesta", send: async () => undefined });
  assert.deepEqual(outcome, { status: "paused", reason: "human_only" });
});

test("activar human_only durante el procesamiento impide el envío final", async () => {
  const memory = memoryControl({ "user-1": active }); let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, generate: async () => { memory.states.set("user-1", { ...alwaysHuman }); return "respuesta"; }, send: async () => { sent += 1; } });
  assert.deepEqual(outcome, { status: "paused", reason: "human_only" }); assert.equal(sent, 0);
});

test("un error en la primera lectura produce fail-closed", async () => {
  let generated = 0; let sent = 0;
  const control = { async registerIncoming() {}, async getAutomationState() { throw new Error("database unavailable"); } };
  const outcome = await runWithConversationHandoff({ control, message, generate: async () => { generated += 1; return "respuesta"; }, send: async () => { sent += 1; } });
  assert.equal(outcome.status, "handoff_error"); assert.deepEqual({ generated, sent }, { generated: 0, sent: 0 });
});

test("un error en la segunda lectura también impide Send API", async () => {
  let reads = 0; let sent = 0;
  const control = { async registerIncoming() {}, async getAutomationState() { reads += 1; if (reads === 2) throw new Error("database unavailable"); return active; } };
  const outcome = await runWithConversationHandoff({ control, message, generate: async () => "respuesta", send: async () => { sent += 1; } });
  assert.equal(outcome.status, "handoff_error"); assert.equal(sent, 0);
});

test("un error al consultar el perfil no interrumpe agente ni Send API", async () => {
  const memory = memoryControl({ "user-1": active }); let generated = 0; let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, background: async () => { throw new Error("Meta unavailable"); }, generate: async () => { generated += 1; return "respuesta"; }, send: async () => { sent += 1; } });
  assert.equal(outcome.status, "sent"); assert.deepEqual({ generated, sent }, { generated: 1, sent: 1 });
});

test("INSTAGRAM_AGENT_ENABLED=false bloquea IA, catálogo y Send API, pero registra actividad", async () => {
  const memory = memoryControl({ "user-1": active }); let generated = 0; let searched = 0; let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, globalEnabled: () => false, generate: async () => { generated += 1; searched += 1; return "respuesta"; }, send: async () => { sent += 1; } });
  assert.deepEqual(outcome, { status: "paused", reason: "global_disabled" });
  assert.equal(memory.registrations, 1);
  assert.deepEqual({ generated, searched, sent }, { generated: 0, searched: 0, sent: 0 });
  assert.deepEqual(memory.states.get("user-1"), active);
});

test("el switch activo permite aplicar el handoff individual normal", async () => {
  const memory = memoryControl({ "user-1": temporaryHuman }); let generated = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, globalEnabled: () => true, generate: async () => { generated += 1; return "respuesta"; }, send: async () => undefined });
  assert.deepEqual(outcome, { status: "paused", reason: "temporary_human" }); assert.equal(generated, 0);
});

test("variable ausente y valores inválidos bloquean de forma fail-closed", () => {
  const previous = process.env.INSTAGRAM_AGENT_ENABLED;
  try {
    delete process.env.INSTAGRAM_AGENT_ENABLED;
    assert.equal(isInstagramAgentGloballyEnabled(), false);
    for (const value of ["false", "TRUE", "1", "yes", ""]) {
      process.env.INSTAGRAM_AGENT_ENABLED = value;
      assert.equal(isInstagramAgentGloballyEnabled(), false);
    }
    process.env.INSTAGRAM_AGENT_ENABLED = "true";
    assert.equal(isInstagramAgentGloballyEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.INSTAGRAM_AGENT_ENABLED;
    else process.env.INSTAGRAM_AGENT_ENABLED = previous;
  }
});

test("apagar globalmente durante procesamiento impide el envío final", async () => {
  const memory = memoryControl({ "user-1": active }); let enabled = true; let sent = 0;
  const outcome = await runWithConversationHandoff({ control: memory.control, message, globalEnabled: () => enabled, generate: async () => { enabled = false; return "respuesta"; }, send: async () => { sent += 1; } });
  assert.deepEqual(outcome, { status: "paused", reason: "global_disabled" }); assert.equal(sent, 0);
});

test("el kill switch no cambia human_only ni agent_enabled", async () => {
  const original = { agentEnabled: false, humanOnly: true };
  const memory = memoryControl({ "user-1": original });
  await runWithConversationHandoff({ control: memory.control, message, globalEnabled: () => false, generate: async () => "respuesta", send: async () => undefined });
  assert.deepEqual(memory.states.get("user-1"), original);
});
