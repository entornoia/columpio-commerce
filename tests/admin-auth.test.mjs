import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isAdministrativeIdentity } from "../src/lib/supabase/admin-identity.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

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

test("login exitoso y sesión existente redirigen al catálogo administrativo", async () => {
  const [login, proxy] = await Promise.all([
    read("src/app/login/page.tsx"),
    read("src/lib/supabase/proxy.ts"),
  ]);
  assert.match(login, /router\.replace\("\/productos"\)/);
  assert.doesNotMatch(login, /router\.replace\("\/"\)/);
  assert.match(proxy, /data\?\.claims && isLogin[\s\S]*urlToDashboard\.pathname = "\/productos"/);
});

test("productos continúa protegido y logout conserva cierre de sesión", async () => {
  const [proxy, shell] = await Promise.all([
    read("src/lib/supabase/proxy.ts"),
    read("src/components/app-shell.tsx"),
  ]);
  assert.doesNotMatch(proxy, /publicPages[^;]*"\/productos"/);
  assert.match(proxy, /if \(!data\?\.claims && !isLogin\)/);
  assert.match(shell, /createClient\(\)\.auth\.signOut\(\)/);
  assert.match(shell, /router\.replace\("\/login"\)/);
});
