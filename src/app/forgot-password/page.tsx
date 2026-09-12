"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

const neutralMessage = "Si el correo corresponde a una cuenta autorizada, recibirás instrucciones para restablecer la contraseña.";

export default function ForgotPasswordPage() {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const redirectTo = new URL("/reset-password", window.location.origin).toString();
    await createClient().auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    setSent(true);
  }

  return <main className="login-page"><section className="login-card">
    <div className="login-brand"><span className="brand-mark">C</span><div><strong>Columpio</strong><small>COMMERCE</small></div></div>
    <span className="eyebrow">RECUPERAR ACCESO</span>
    <h1>Restablece tu contraseña.</h1>
    <p>Te enviaremos un enlace seguro para definir una nueva contraseña.</p>
    {sent ? <div className="login-status" role="status">{neutralMessage}</div> : <form onSubmit={submit}>
      <label>Correo electrónico<input name="email" type="email" autoComplete="email" required disabled={!configured || loading} /></label>
      <button className="primary-button" disabled={!configured || loading}>{loading ? "Enviando…" : "Enviar enlace"}</button>
    </form>}
    <Link className="login-help-link" href="/login">Volver al login</Link>
  </section></main>;
}
