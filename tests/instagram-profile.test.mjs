import assert from "node:assert/strict";
import test from "node:test";
import { instagramProfileLabel } from "../src/lib/channels/instagram/profile-label.ts";
import { profileNeedsRefresh, refreshInstagramUsername } from "../src/lib/channels/instagram/profile-refresh.ts";

const now = new Date("2026-08-26T12:00:00.000Z");

function memoryRepository(initial) {
  const record = { ...initial };
  return {
    record,
    repository: {
      async get() { return { username: record.username, profileCheckedAt: record.profileCheckedAt }; },
      async saveUsername(_externalUserId, username, checkedAt) { record.username = username; record.profileCheckedAt = checkedAt; },
      async markChecked(_externalUserId, checkedAt) { record.profileCheckedAt = checkedAt; },
    },
  };
}

test("un perfil correcto guarda username y fecha de consulta", async () => {
  const memory = memoryRepository({ username: null, profileCheckedAt: null, agentEnabled: false, humanOnly: true });
  const result = await refreshInstagramUsername({ repository: memory.repository, externalUserId: "280100004721", fetchUsername: async () => "clienta.columpio", now });
  assert.deepEqual(result, { status: "updated", username: "clienta.columpio" });
  assert.equal(memory.record.username, "clienta.columpio");
  assert.equal(memory.record.profileCheckedAt, now.toISOString());
  assert.deepEqual({ agentEnabled: memory.record.agentEnabled, humanOnly: memory.record.humanOnly }, { agentEnabled: false, humanOnly: true });
});

test("un error de Meta no borra el username previo y registra el intento", async () => {
  const memory = memoryRepository({ username: "nombre.previo", profileCheckedAt: "2026-08-01T00:00:00.000Z", agentEnabled: true, humanOnly: false });
  const result = await refreshInstagramUsername({ repository: memory.repository, externalUserId: "280100004721", fetchUsername: async () => { throw new Error("Meta unavailable"); }, now });
  assert.equal(result.status, "failed");
  assert.equal(result.checkedAtPersisted, true);
  assert.equal(memory.record.username, "nombre.previo");
  assert.equal(memory.record.profileCheckedAt, now.toISOString());
  assert.deepEqual({ agentEnabled: memory.record.agentEnabled, humanOnly: memory.record.humanOnly }, { agentEnabled: true, humanOnly: false });
});

test("un perfil reciente con username no vuelve a consultar Meta", async () => {
  const memory = memoryRepository({ username: "perfil.reciente", profileCheckedAt: "2026-08-25T12:00:00.000Z" });
  let calls = 0;
  const result = await refreshInstagramUsername({ repository: memory.repository, externalUserId: "280100004721", fetchUsername: async () => { calls += 1; return "otro"; }, now });
  assert.deepEqual(result, { status: "fresh", username: "perfil.reciente" });
  assert.equal(calls, 0);
});

test("si no existe username se consulta aunque el último intento sea reciente", () => {
  assert.equal(profileNeedsRefresh({ username: null, profileCheckedAt: "2026-08-26T11:00:00.000Z" }, now.getTime()), true);
});

test("la etiqueta visual usa @username y tiene fallback", () => {
  assert.equal(instagramProfileLabel("clienta.columpio"), "@clienta.columpio");
  assert.equal(instagramProfileLabel(null), "Usuario de Instagram");
});
