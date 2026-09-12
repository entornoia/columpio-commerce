import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("recovery solicita enlace sin revelar si el correo existe", async () => {
  const source = await read("src/app/forgot-password/page.tsx");
  assert.match(source, /resetPasswordForEmail\(email, \{ redirectTo \}\)/);
  assert.match(source, /new URL\("\/reset-password", window\.location\.origin\)/);
  assert.match(source, /Si el correo corresponde a una cuenta autorizada/);
  assert.doesNotMatch(source, /user not found|usuario no existe/i);
});

test("reset intercambia el code PKCE, limpia la URL y actualiza solo password", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.match(source, /history\.replaceState\(\{\}, "", "\/reset-password"\)/);
  assert.match(source, /auth\.updateUser\(\{ password \}\)/);
  assert.match(source, /auth\.signOut\(\)/);
  assert.match(source, /router\.replace\("\/login"\)/);
  assert.doesNotMatch(source, /service.role|SUPABASE_SERVICE_ROLE_KEY|console\./);
});

test("reset informa enlaces expirados y exige confirmación de contraseña", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /error_code/);
  assert.match(source, /inválido o ya expiró/);
  assert.match(source, /password !== confirmation/);
  assert.match(source, /password\.length < 8/);
});

test("proxy abre solo las dos rutas públicas de recovery", async () => {
  const source = await read("src/lib/supabase/proxy.ts");
  assert.match(source, /"\/forgot-password", "\/reset-password"/);
  assert.doesNotMatch(source, /startsWith\("\/reset-password/);
});
