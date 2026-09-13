"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RecoveryState = "checking" | "ready" | "invalid" | "saving";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState>("checking");
  const [error, setError] = useState("");
  const recoverySessionValidated = useRef(false);

  useEffect(() => {
    let active = true;
    let recoveryEventSeen = false;
    const initialUrl = new URL(window.location.href);
    const hasAuthError = initialUrl.searchParams.has("error") || initialUrl.searchParams.has("error_code");
    const hasRecoveryCode = initialUrl.searchParams.has("code");

    if (hasAuthError || !hasRecoveryCode) {
      queueMicrotask(() => {
        if (active) setState("invalid");
      });
      return () => {
        active = false;
      };
    }

    const supabase = createClient();

    function confirmRecoverySession() {
      recoverySessionValidated.current = true;
      if (active) setState("ready");
    }

    function cleanRecoveryUrl() {
      const cleanUrl = new URL(window.location.href);
      ["code", "error", "error_code", "error_description", "sb_flow_id"].forEach((parameter) => {
        cleanUrl.searchParams.delete(parameter);
      });
      window.history.replaceState(window.history.state, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "PASSWORD_RECOVERY" || !session) return;
      recoveryEventSeen = true;
      cleanRecoveryUrl();
      confirmRecoverySession();
    });

    async function establishRecoverySession() {
      const { error: initializationError } = await supabase.auth.initialize();
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;

      const automaticRecoverySucceeded = !initializationError && !sessionError && Boolean(data.session);
      if (recoveryEventSeen || automaticRecoverySucceeded) {
        cleanRecoveryUrl();
        confirmRecoverySession();
        return;
      }

      recoverySessionValidated.current = false;
      setState("invalid");
    }

    void establishRecoverySession();
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmation) return setError("Las contraseñas no coinciden.");

    setState("saving");
    const supabase = createClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (!recoverySessionValidated.current || sessionError || !sessionData.session) {
      recoverySessionValidated.current = false;
      setState("invalid");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setState("ready");
      setError("No fue posible actualizar la contraseña. Solicita un enlace nuevo.");
      return;
    }
    recoverySessionValidated.current = false;
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><span className="brand-mark">C</span><div><strong>Columpio</strong><small>COMMERCE</small></div></div>
    <span className="eyebrow">NUEVA CONTRASEÑA</span>
    <h1>Protege tu acceso.</h1>
    {state === "checking" && <div className="login-status" role="status">Validando el enlace seguro…</div>}
    {state === "invalid" && <><div className="form-error">El enlace es inválido o ya expiró. Solicita uno nuevo.</div><Link className="primary-button" href="/forgot-password">Solicitar otro enlace</Link></>}
    {(state === "ready" || state === "saving") && <form onSubmit={submit}>
      <label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required disabled={state === "saving"} /></label>
      <label>Confirmar contraseña<input name="confirmation" type="password" autoComplete="new-password" minLength={8} required disabled={state === "saving"} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={state === "saving"}>{state === "saving" ? "Guardando…" : "Guardar contraseña"}</button>
    </form>}
    <Link className="login-help-link" href="/login">Volver al login</Link>
  </section></main>;
}
