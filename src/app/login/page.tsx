"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (authError) return setError("Correo o contraseña incorrectos.");
    router.replace("/");
    router.refresh();
  }

  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><span className="brand-mark">C</span><div><strong>Columpio</strong><small>COMMERCE</small></div></div>
    <span className="eyebrow">ACCESO ADMINISTRATIVO</span>
    <h1>Bienvenida.</h1>
    <p>Ingresa con el usuario administrador autorizado para gestionar catálogo y stock.</p>
    {!configured && <div className="form-error">Falta configurar Supabase en <code>.env.local</code>.</div>}
    <form onSubmit={submit}>
      <label>Correo electrónico<input name="email" type="email" autoComplete="email" required disabled={!configured} /></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required disabled={!configured} /></label>
      {error && <div className="form-error">{error}</div>}
      <button className="primary-button" disabled={!configured || loading}>{loading ? "Ingresando…" : "Ingresar"}</button>
    </form>
  </section></main>;
}

