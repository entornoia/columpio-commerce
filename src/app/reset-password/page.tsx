"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type RecoveryState = "checking" | "ready" | "invalid" | "saving";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function establishRecoverySession() {
      const url = new URL(window.location.href);
      if (url.searchParams.get("error") || url.searchParams.get("error_code")) {
        if (active) setState("invalid");
        return;
      }

      const code = url.searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (active) setState("invalid");
          return;
        }
        window.history.replaceState({}, "", "/reset-password");
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      setState(!sessionError && data.session ? "ready" : "invalid");
    }

    void establishRecoverySession();
    return () => { active = false; };
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
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setState("ready");
      setError("No fue posible actualizar la contraseña. Solicita un enlace nuevo.");
      return;
    }
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
