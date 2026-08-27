import assert from "node:assert/strict";
import test from "node:test";
import { isAdministrativeIdentity } from "../src/lib/supabase/admin-identity.ts";

test("una solicitud sin usuario no puede listar ni modificar conversaciones", () => {
  assert.equal(isAdministrativeIdentity(null, "authenticated"), false);
  assert.equal(isAdministrativeIdentity(undefined, undefined), false);
});

test("una sesión sin el claim authenticated no obtiene autorización administrativa", () => {
  assert.equal(isAdministrativeIdentity({ id: "user" }, "anon"), false);
  assert.equal(isAdministrativeIdentity({ id: "user" }, undefined), false);
});

test("reutiliza el criterio administrativo vigente de usuario válido y rol authenticated", () => {
  assert.equal(isAdministrativeIdentity({ id: "admin" }, "authenticated"), true);
});
