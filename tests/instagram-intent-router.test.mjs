import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AMBIGUOUS_EXCHANGE_REASON, classifyIntentByRules, COMMERCIAL_CONTINUATION_REASON, GREETING_REASON } from "../src/lib/channels/instagram/intent-rules.ts";
import { routeInstagramIntent } from "../src/lib/channels/instagram/intent-router.ts";
import { runWithConversationHandoff } from "../src/lib/channels/instagram/handoff.ts";
import { generalInfoResponse } from "../src/lib/channels/instagram/general-info.ts";
import { EXCHANGE_CLARIFICATION_RESPONSE, GREETING_RESPONSE, PAUSE_INTENTS, safeIntentResponse } from "../src/lib/channels/instagram/intent-responses.ts";

let sequence = 0;
const emptyIntent = { lastIntent: null, lastIntentAt: null };
function message(text, overrides = {}) {
  sequence += 1;
  return { channel: "instagram", eventId: `intent-mid-${sequence}`, externalUserId: `intent-user-${sequence}`, externalConversationId: `intent-user-${sequence}`, text, imageUrl: null, receivedAt: "2026-08-28T12:00:00.000Z", ...overrides };
}

test("las reglas clasifican los ejemplos prioritarios", () => {
  const cases = [
    ["¿Tienen este blazer en M?", "sales"],
    ["Compré una pieza y quiero saber cómo aplicar garantía", "after_sales"],
    ["Me regalaron una pieza de su tienda y quiero hacer un cambio", "exchange_return"],
    ["Soy community manager y quiero ofrecerles manejo de redes", "business_proposal"],
    ["😍", "social_reaction"],
    ["😍 cuánto sale?", "sales"],
    ["¿Dónde están ubicados?", "general_info"],
    ["Quiero hablar con una persona", "human_request"],
  ];
  for (const [text, intent] of cases) assert.equal(classifyIntentByRules(message(text), emptyIntent)?.intent, intent, text);
});

test("human_request gana sobre cualquier señal comercial", () => {
  assert.equal(classifyIntentByRules(message("Quiero hablar con una persona para comprar el blazer talla M"), emptyIntent)?.intent, "human_request");
});

test("mensajes elípticos heredan sales solo durante 30 minutos", () => {
  const current = Date.parse("2026-08-28T12:00:00.000Z");
  for (const text of ["M", "ese", "agrégalo", "sí, dos", "mándame el link", "sí", "sí por favor", "dale", "ok", "bueno", "perfecto", "hazlo", "muéstrame"]) {
    assert.equal(classifyIntentByRules(message(text), { lastIntent: "sales", lastIntentAt: "2026-08-28T11:30:00.000Z" }, current)?.intent, "sales");
    const outside = classifyIntentByRules(message(text), { lastIntent: "sales", lastIntentAt: "2026-08-28T11:29:59.000Z" }, current);
    assert.equal(outside?.intent, "unknown"); assert.equal(outside?.reason, COMMERCIAL_CONTINUATION_REASON);
  }
});

test("la continuación comercial real permanece en sales", () => {
  const current = Date.parse("2026-08-28T12:00:00.000Z");
  assert.equal(classifyIntentByRules(message("Tienes blusas"), emptyIntent, current)?.intent, "sales");
  const recent = { lastIntent: "sales", lastIntentAt: "2026-08-28T11:55:00.000Z" };
  assert.equal(classifyIntentByRules(message("En negro tienes?"), recent, current)?.intent, "sales");
  for (const text of ["Sí por favor", "Dale", "Muéstrame"]) assert.equal(classifyIntentByRules(message(text), recent, current)?.intent, "sales", text);
  assert.equal(classifyIntentByRules(message("clienta@example.com"), recent, current)?.intent, "sales");
});

test("búsquedas explícitas de producto son sales determinístico", () => {
  const cases = [
    "Estoy buscando un pantalón negro",
    "Busco una blusa marfil",
    "Necesito un blazer talla M",
    "Tienes pantalones negros?",
    "Busco algo para una fiesta",
  ];
  for (const text of cases) {
    const classification = classifyIntentByRules(message(text), emptyIntent);
    assert.equal(classification?.intent, "sales", text);
    assert.equal(classification?.source, "rule", text);
  }
  assert.equal(classifyIntentByRules(message("Estoy buscando cómo devolver un pantalón que compré"), emptyIntent)?.intent, "exchange_return");
  assert.equal(classifyIntentByRules(message("Estoy buscando una persona que me atienda"), emptyIntent)?.intent, "human_request");
});

test("una señal sensible explícita nunca hereda sales", () => {
  const state = { lastIntent: "sales", lastIntentAt: "2026-08-28T11:50:00.000Z" };
  assert.equal(classifyIntentByRules(message("quiero cambiar la pieza que me regalaron"), state)?.intent, "exchange_return");
  assert.equal(classifyIntentByRules(message("quiero hablar con una persona"), state)?.intent, "human_request");
});

test("cambios de prendas poseídas prevalecen sobre talla, color y producto", () => {
  const previousSales = { lastIntent: "sales", lastIntentAt: "2026-08-28T11:50:00.000Z" };
  const exchanges = [
    "quiero devolver la pieza",
    "me quedó grande y quiero cambiarlo",
    "me quedó chico y quiero cambiarlo",
    "tengo la prenda en M y la quiero cambiar por S",
    "Me regalaron una prenda y quiero cambiarla",
    "Tengo un Emilia M y quiero cambiarlo por S",
    "No lo he usado, quiero cambiarlo",
  ];
  for (const text of exchanges) assert.equal(classifyIntentByRules(message(text), previousSales)?.intent, "exchange_return", text);
});

test("una confirmación posterior de posesión resuelve exchange_return", () => {
  const clarificationContext = { lastIntent: "unknown", lastIntentAt: "2026-08-28T11:55:00.000Z" };
  for (const text of ["Me la regalaron", "Ya la tengo", "La compré", "No la he usado"]) {
    assert.equal(classifyIntentByRules(message(text), clarificationContext)?.intent, "exchange_return", text);
  }
});

test("cambios inequívocos del look o carrito siguen siendo sales", () => {
  const sales = [
    "quiero cambiar el color del look",
    "mejor cámbiame el blazer negro por el camel en el carrito",
    "antes de confirmar quiero cambiar la talla del carrito",
    "Cámbiame el Emilia negro por el camel en el carrito",
    "Mejor cambia el M por S antes de confirmar el pedido",
  ];
  for (const text of sales) assert.equal(classifyIntentByRules(message(text), emptyIntent)?.intent, "sales", text);
});

test("solo los mensajes ambiguos usan LLM estructurado", async () => {
  let calls = 0;
  const obvious = await routeInstagramIntent(message("¿Tienen stock del blazer?"), emptyIntent, async () => { calls += 1; throw new Error("no debe ejecutarse"); });
  const ambiguous = await routeInstagramIntent(message("Necesito ayuda con algo"), emptyIntent, async () => { calls += 1; return { intent: "after_sales", confidence: 0.91, reason: "Caso relacionado con una compra" }; });
  assert.equal(obvious.intent, "sales"); assert.equal(ambiguous.intent, "after_sales"); assert.equal(ambiguous.source, "llm"); assert.equal(calls, 1);
});

test("saludos puros son general_info y un saludo con consulta sigue siendo sales", () => {
  for (const text of ["Hola", "Holaa", "Buenas", "Buenos días", "Buen día", "Buenas tardes", "Buenas noches", "Cómo están", "Cómo estás"]) {
    assert.equal(classifyIntentByRules(message(text), emptyIntent)?.intent, "general_info", text);
  }
  assert.equal(classifyIntentByRules(message("Hola, tienen blusas?"), emptyIntent)?.intent, "sales");
});

test("Hola y Buenas tardes responden sin tools ni handoff y permiten continuar", async () => {
  for (const greeting of ["Hola", "Buenas tardes"]) {
    const f = controlFixture(); let sent = "";
    const result = await simulateFlow(message(greeting), f, { send: async (text) => { sent = text; }, agent: async () => { throw new Error("no debe ejecutar agente"); } });
    assert.equal(result.outcome.status, "sent"); assert.equal(result.agentCalls, 0); assert.equal(f.state.agentEnabled, true); assert.equal(f.state.pauses, 0); assert.match(sent, /en qué te puedo ayudar/i);
    const next = await simulateFlow(message("¿Tienen el blazer?"), f, { agent: async () => "Respuesta comercial" });
    assert.equal(next.agentCalls, 1); assert.equal(next.outcome.status, "sent");
  }
});

test("un cambio sin posesión confirmada pide aclaración sin handoff", async () => {
  const f = controlFixture(); const sent = []; let llmCalls = 0;
  const result = await simulateFlow(message("Quiero cambiar una blusa"), f, { classifier: async () => { llmCalls += 1; throw new Error("no debe ejecutarse"); }, send: async (text) => { sent.push(text); } });
  assert.equal(result.outcome.status, "sent"); assert.equal(result.agentCalls, 0); assert.equal(llmCalls, 0);
  assert.equal(f.state.agentEnabled, true); assert.equal(f.state.pauses, 0); assert.match(sent[0], /ya la tienes contigo/i);
  const confirmation = await simulateFlow(message("Me la regalaron"), f, { classifier: async () => { llmCalls += 1; throw new Error("no debe ejecutarse"); }, send: async (text) => { sent.push(text); } });
  assert.equal(confirmation.outcome.status, "sent"); assert.equal(confirmation.agentCalls, 0); assert.equal(llmCalls, 0);
  assert.equal(f.state.lastIntent, "exchange_return"); assert.equal(f.state.agentEnabled, false); assert.equal(sent.length, 2);
});

test("baja confianza, timeout, error y JSON inválido producen unknown", async () => {
  const values = [
    async () => ({ intent: "sales", confidence: 0.74, reason: "duda" }),
    async () => { throw new DOMException("timeout", "AbortError"); },
    async () => { throw new Error("OpenAI unavailable"); },
    async () => "no-json",
  ];
  for (const classifier of values) assert.equal((await routeInstagramIntent(message("mensaje ambiguo"), emptyIntent, classifier)).intent, "unknown");
});

function controlFixture({ agentEnabled = true, humanOnly = false, lastIntent = null, lastIntentAt = null } = {}) {
  const state = { agentEnabled, humanOnly, humanTakeoverAt: null, lastIntent, lastIntentAt, lastInboundAt: null, registrations: 0, pauses: 0, classifications: 0, cases: [] };
  return { state, control: {
    async registerIncoming(incoming) { state.registrations += 1; state.lastInboundAt = incoming.receivedAt; },
    async getAutomationState() { return { agentEnabled: state.agentEnabled, humanOnly: state.humanOnly }; },
    async getIntentState() { return { lastIntent: state.lastIntent, lastIntentAt: state.lastIntentAt }; },
    async recordIntent(_channel, _user, intent, at) { state.classifications += 1; state.lastIntent = intent; state.lastIntentAt = at; },
    async pauseTemporarily(_channel, _user, changedAt = "2026-08-28T12:00:01.000Z") { state.pauses += 1; state.agentEnabled = false; state.humanOnly = false; state.humanTakeoverAt = changedAt; },
    async transitionToTemporaryHuman(_channel, _user, eventId, reason, at, changedAt = "2026-08-28T12:00:01.000Z") { if (!state.agentEnabled || state.humanOnly) return { transitioned: false, caseId: null }; state.classifications += 1; state.pauses += 1; state.lastIntent = reason === "unknown_escalation" ? "unknown" : reason; state.lastIntentAt = at; state.agentEnabled = false; state.humanOnly = false; state.humanTakeoverAt = changedAt; const caseId = `case-${state.cases.length + 1}`; state.cases.push({ id: caseId, eventId, reason, status: "pending" }); return { transitioned: true, caseId }; },
  } };
}

async function simulateFlow(incoming, fixture, { classifier, send = async () => undefined, globalEnabled = () => true, agent = async () => "Respuesta comercial" } = {}) {
  let agentCalls = 0;
  const outcome = await runWithConversationHandoff({
    control: fixture.control,
    message: { channel: "instagram", externalUserId: incoming.externalUserId, eventId: incoming.eventId, receivedAt: incoming.receivedAt },
    globalEnabled,
    generate: async () => {
      const previous = await fixture.control.getIntentState("instagram", incoming.externalUserId);
      const classification = await routeInstagramIntent(incoming, previous, classifier);
      const ambiguousExchange = classification.intent === "unknown" && classification.reason === AMBIGUOUS_EXCHANGE_REASON;
      const secondUnknown = classification.intent === "unknown" && !ambiguousExchange && classification.reason !== COMMERCIAL_CONTINUATION_REASON && previous.lastIntent === "unknown" && previous.lastIntentAt && Date.parse(incoming.receivedAt) - Date.parse(previous.lastIntentAt) <= 24 * 60 * 60_000;
      const pause = PAUSE_INTENTS.has(classification.intent) || Boolean(secondUnknown);
      if (!pause) await fixture.control.recordIntent("instagram", incoming.externalUserId, classification.intent, incoming.receivedAt);
      if (classification.intent === "sales") { agentCalls += 1; return { response: await agent(), pause: false, intent: classification.intent, classifiedAt: incoming.receivedAt }; }
      if (classification.intent === "social_reaction") return { response: null, pause: false, intent: classification.intent, classifiedAt: incoming.receivedAt };
      if (classification.intent === "general_info") return { response: classification.reason === GREETING_REASON ? GREETING_RESPONSE : generalInfoResponse(incoming.text), pause: false, intent: classification.intent, classifiedAt: incoming.receivedAt };
      return { response: ambiguousExchange ? EXCHANGE_CLARIFICATION_RESPONSE : safeIntentResponse(classification.intent, Boolean(secondUnknown)), pause, intent: classification.intent, classifiedAt: incoming.receivedAt };
    },
    pauseBeforeSend: (value) => value.pause,
    persistPause: async (value) => (await fixture.control.transitionToTemporaryHuman("instagram", incoming.externalUserId, incoming.eventId, value.intent === "unknown" ? "unknown_escalation" : value.intent, value.classifiedAt)).transitioned,
    send: async (value) => { if (value.response) await send(value.response); },
  });
  return { outcome, agentCalls };
}

test("sales conserva el flujo del agente comercial", async () => {
  const f = controlFixture(); let sends = 0;
  const result = await simulateFlow(message("¿Tienen el blazer en M?"), f, { send: async () => { sends += 1; } });
  assert.equal(result.outcome.status, "sent"); assert.equal(result.agentCalls, 1); assert.equal(sends, 1); assert.equal(f.state.lastIntent, "sales");
});

test("un unknown histórico no escala una búsqueda comercial explícita", async () => {
  const f = controlFixture({ lastIntent: "unknown", lastIntentAt: "2026-08-28T11:55:00.000Z" });
  let sends = 0; let sellerCalls = 0;
  const result = await simulateFlow(message("Estoy buscando un pantalón negro"), f, {
    classifier: async () => { throw new Error("no debe consultar LLM"); },
    agent: async () => { sellerCalls += 1; return "Resultado de search_catalog"; },
    send: async () => { sends += 1; },
  });
  assert.equal(result.outcome.status, "sent");
  assert.equal(result.outcome.value.intent, "sales");
  assert.equal(result.agentCalls, 1); assert.equal(sellerCalls, 1); assert.equal(sends, 1);
  assert.equal(f.state.agentEnabled, true); assert.equal(f.state.humanOnly, false);
  assert.equal(f.state.humanTakeoverAt, null); assert.equal(f.state.cases.length, 0);
});

test("emoji puro no responde ni ejecuta agente", async () => {
  const f = controlFixture(); let sends = 0;
  const result = await simulateFlow(message("😍"), f, { send: async () => { sends += 1; } });
  assert.equal(result.outcome.status, "sent"); assert.equal(result.outcome.value.intent, "social_reaction"); assert.equal(result.agentCalls, 0); assert.equal(sends, 0); assert.equal(f.state.lastIntent, "social_reaction");
});

test("general_info usa solo configuración confirmada y no ejecuta tools", async () => {
  const previous = process.env.INSTAGRAM_STORE_LOCATION; delete process.env.INSTAGRAM_STORE_LOCATION;
  const f = controlFixture(); let sent = "";
  try {
    const result = await simulateFlow(message("¿Dónde están ubicados?"), f, { send: async (text) => { sent = text; } });
    assert.equal(result.agentCalls, 0); assert.match(sent, /no tengo esa información confirmada/i);
  } finally { if (previous !== undefined) process.env.INSTAGRAM_STORE_LOCATION = previous; }
});

test("human request, garantía, cambio confirmado y propuesta pausan antes del acuse", async () => {
  for (const text of ["Quiero hablar con una persona", "Necesito aplicar garantía", "Quiero cambiar esta pieza que me regalaron", "Soy community manager y ofrezco manejo de redes"]) {
    const f = controlFixture();
    const result = await simulateFlow(message(text), f, { send: async () => { assert.equal(f.state.agentEnabled, false, "la pausa debe existir antes del envío"); } });
    assert.equal(result.outcome.status, "sent"); assert.equal(f.state.pauses, 1); assert.equal(result.agentCalls, 0); assert.equal(f.state.humanOnly, false);
  }
});

test("integración: cambio de regalo persiste handoff, acusa una vez y bloquea todo flujo comercial posterior", async () => {
  const f = controlFixture(); let sellerAgentCalls = 0; let llmCalls = 0; let searchCatalogCalls = 0; let cartCalls = 0; const sent = [];
  const first = await simulateFlow(message("Quiero hacer un cambio de una blusa que me regalaron"), f, {
    classifier: async () => { llmCalls += 1; return { intent: "sales", confidence: 1, reason: "no debe ejecutarse" }; },
    agent: async () => { sellerAgentCalls += 1; searchCatalogCalls += 1; cartCalls += 1; return "no debe ejecutarse"; },
    send: async (text) => { sent.push(text); assert.equal(f.state.agentEnabled, false); },
  });
  assert.equal(first.outcome.value.intent, "exchange_return"); assert.equal(first.agentCalls, 0);
  assert.equal(llmCalls, 0); assert.equal(sellerAgentCalls, 0); assert.equal(searchCatalogCalls, 0); assert.equal(cartCalls, 0);
  assert.equal(f.state.agentEnabled, false); assert.equal(f.state.humanOnly, false); assert.ok(f.state.humanTakeoverAt);
  assert.equal(f.state.lastIntent, "exchange_return"); assert.equal(f.state.lastIntentAt, "2026-08-28T12:00:00.000Z");
  assert.equal(sent.length, 1); assert.match(sent[0], /cambio de una prenda que ya tienes/i);

  const pausedIntent = f.state.lastIntent;
  for (const [index, text] of ["¿Me contactarán?", "¿Tienes blusas?", "Hola"].entries()) {
    const next = await simulateFlow(message(text, { receivedAt: `2026-08-28T12:0${index + 1}:00.000Z` }), f, { classifier: async () => { llmCalls += 1; return { intent: "sales", confidence: 1, reason: "no debe ejecutarse" }; }, send: async (value) => { sent.push(value); }, agent: async () => { sellerAgentCalls += 1; return "no debe ejecutarse"; } });
    assert.equal(next.outcome.status, "paused"); assert.equal(next.agentCalls, 0);
  }
  assert.equal(llmCalls, 0); assert.equal(sellerAgentCalls, 0); assert.equal(sent.length, 1);
  assert.equal(f.state.lastIntent, pausedIntent); assert.equal(f.state.lastInboundAt, "2026-08-28T12:03:00.000Z");

  f.state.agentEnabled = true; f.state.humanOnly = false; f.state.humanTakeoverAt = null;
  const reactivated = await simulateFlow(message("¿Tienen el blazer?", { receivedAt: "2026-08-28T12:04:00.000Z" }), f, { send: async (value) => { sent.push(value); }, agent: async () => { sellerAgentCalls += 1; return "Respuesta comercial"; } });
  assert.equal(reactivated.outcome.status, "sent"); assert.equal(reactivated.agentCalls, 1); assert.equal(sellerAgentCalls, 1); assert.equal(sent.length, 2);
});

test("dos eventos concurrentes solo permiten un acuse de handoff", async () => {
  const f = controlFixture(); let sends = 0;
  const first = message("Quiero devolver una prenda que me regalaron", { externalUserId: "race-user", externalConversationId: "race-user" });
  const second = message("Quiero hablar con una persona", { externalUserId: "race-user", externalConversationId: "race-user" });
  const outcomes = await Promise.all([
    simulateFlow(first, f, { send: async () => { sends += 1; } }),
    simulateFlow(second, f, { send: async () => { sends += 1; } }),
  ]);
  assert.equal(sends, 1);
  assert.equal(outcomes.filter(({ outcome }) => outcome.status === "sent").length, 1);
  assert.equal(outcomes.filter(({ outcome }) => outcome.status === "paused").length, 1);
  assert.equal(f.state.cases.length, 1);
});

test("un fallo enviando el acuse conserva la pausa", async () => {
  const f = controlFixture();
  await assert.rejects(simulateFlow(message("Quiero hablar con una persona"), f, { send: async () => { throw new Error("Meta unavailable"); } }), /Meta unavailable/);
  assert.equal(f.state.agentEnabled, false); assert.equal(f.state.pauses, 1);
});

test("el siguiente mensaje después de la pausa no se clasifica", async () => {
  const f = controlFixture(); let sends = 0;
  const exchange = await simulateFlow(message("Quiero devolver una prenda que me regalaron"), f, { send: async () => { sends += 1; } });
  assert.equal(exchange.agentCalls, 0);
  const classified = f.state.classifications;
  const result = await simulateFlow(message("¿Me contactarán?", { externalUserId: "paused-user", externalConversationId: "paused-user" }), f, {
    classifier: async () => { throw new Error("no debe clasificar"); },
    send: async () => { sends += 1; },
  });
  assert.equal(result.outcome.status, "paused"); assert.equal(f.state.classifications, classified); assert.equal(sends, 1);
});

test("human_only y kill switch bloquean antes del clasificador", async () => {
  for (const setup of [{ humanOnly: true }, {}]) {
    const f = controlFixture(setup); let llm = 0;
    const result = await simulateFlow(message("mensaje ambiguo"), f, { globalEnabled: () => setup.humanOnly ? true : false, classifier: async () => { llm += 1; return { intent: "sales", confidence: 1, reason: "x" }; } });
    assert.equal(result.outcome.status, "paused"); assert.equal(llm, 0); assert.equal(f.state.classifications, 0);
  }
});

test("segundo unknown dentro de 24 horas deriva y pausa", async () => {
  const f = controlFixture({ lastIntent: "unknown", lastIntentAt: "2026-08-27T13:00:00.000Z" });
  const result = await simulateFlow(message("todavía no sé explicarlo"), f, { classifier: async () => ({ intent: "unknown", confidence: 0.9, reason: "Ambiguo" }), send: async () => { assert.equal(f.state.agentEnabled, false); } });
  assert.equal(result.outcome.status, "sent"); assert.equal(f.state.pauses, 1);
});

test("el processor integra el router antes de ejecutar el agente de ventas", async () => {
  const source = await readFile(new URL("../src/lib/channels/instagram/processor.ts", import.meta.url), "utf8");
  assert.match(source, /routeInstagramIntent\(message, previousIntent/);
  assert.match(source, /classification\.intent !== "sales"[\s\S]*runSellerAgent/);
  assert.match(source, /pauseBeforeSend: \(generated\) => generated\.pauseAfterSend === true/);
});

test("la migración 009 persiste solo intención y fecha sin texto", async () => {
  const sql = await readFile(new URL("../supabase/migrations/009_instagram_intent_router.sql", import.meta.url), "utf8");
  assert.match(sql, /last_intent text/); assert.match(sql, /last_intent_at timestamptz/);
  for (const intent of ["sales", "after_sales", "exchange_return", "general_info", "business_proposal", "social_reaction", "human_request", "unknown"]) assert.match(sql, new RegExp(`'${intent}'`));
  assert.doesNotMatch(sql, /message_text|message_content|history/i);
});
