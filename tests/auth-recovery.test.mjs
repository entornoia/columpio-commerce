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

test("reset deja el intercambio PKCE automático en un único responsable", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.doesNotMatch(source, /exchangeCodeForSession/);
  assert.match(source, /auth\.initialize\(\)/);
  assert.match(source, /auth\.getSession\(\)/);
  assert.match(source, /automaticRecoverySucceeded = !initializationError && !sessionError && Boolean\(data\.session\)/);
  assert.match(source, /recoveryEventSeen \|\| automaticRecoverySucceeded/);
});

test("recovery exige code original y no acepta una sesión administrativa preexistente", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /const hasRecoveryCode = initialUrl\.searchParams\.has\("code"\)/);
  assert.match(source, /if \(hasAuthError \|\| !hasRecoveryCode\)/);
  assert.ok(source.indexOf("if (hasAuthError || !hasRecoveryCode)") < source.indexOf("const supabase = createClient()"));
  assert.match(source, /recoverySessionValidated\.current/);
});

test("PASSWORD_RECOVERY confirma la sesión sin depender exclusivamente del evento", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /onAuthStateChange\(\(event, session\)/);
  assert.match(source, /event !== "PASSWORD_RECOVERY" \|\| !session/);
  assert.match(source, /recoveryEventSeen = true/);
  assert.match(source, /recoveryEventSeen \|\| automaticRecoverySucceeded/);
  assert.match(source, /subscription\.unsubscribe\(\)/);
});

test("exchange automático fallido o sin sesión conserva el estado inválido", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /!initializationError && !sessionError && Boolean\(data\.session\)/);
  assert.match(source, /recoverySessionValidated\.current = false;\s+setState\("invalid"\)/);
  assert.match(source, /error_code/);
  assert.match(source, /inválido o ya expiró/);
});

test("reset limpia solo parámetros Auth después de confirmar recovery", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  assert.match(source, /function cleanRecoveryUrl\(\)/);
  assert.match(source, /\["code", "error", "error_code", "error_description", "sb_flow_id"\]/);
  assert.match(source, /history\.replaceState\(window\.history\.state, "", `\$\{cleanUrl\.pathname\}\$\{cleanUrl\.search\}\$\{cleanUrl\.hash\}`\)/);
  assert.ok(source.indexOf("function confirmRecoverySession") < source.indexOf("cleanRecoveryUrl();\n        confirmRecoverySession();"));
});

test("password solo se actualiza tras recovery validado y termina cerrando sesión", async () => {
  const source = await read("src/app/reset-password/page.tsx");
  const guard = source.indexOf("if (!recoverySessionValidated.current || sessionError || !sessionData.session)");
  const update = source.indexOf("auth.updateUser({ password })");
  const signOut = source.indexOf("auth.signOut()");
  assert.ok(guard >= 0 && guard < update);
  assert.ok(update < signOut);
  assert.match(source, /auth\.updateUser\(\{ password \}\)/);
  assert.match(source, /auth\.signOut\(\)/);
  assert.match(source, /router\.replace\("\/login"\)/);
  assert.doesNotMatch(source, /service.role|SUPABASE_SERVICE_ROLE_KEY/);
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

test("forgot-password y reset-password nunca usan AppShell administrativo", async () => {
  const source = await read("src/components/app-shell.tsx");
  assert.match(source, /"\/login", "\/forgot-password", "\/reset-password"/);
  assert.match(source, /publicPages\.includes\(pathname\).*return children/);
});

test("recovery no registra codes, tokens ni passwords", async () => {
  const sources = await Promise.all([
    read("src/app/forgot-password/page.tsx"),
    read("src/app/reset-password/page.tsx"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)/);
    assert.doesNotMatch(source, /access_token|refresh_token/);
  }
});
