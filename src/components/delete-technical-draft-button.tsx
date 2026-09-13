"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CONFIRMATION = "Este borrador técnico se eliminará definitivamente. Esta acción no se puede deshacer.";

export function DeleteTechnicalDraftButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/products/${productId}/draft-deletion`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => setEligible(body?.eligibility?.eligible === true))
      .catch(() => undefined);
    return () => controller.abort();
  }, [productId]);

  const remove = async () => {
    if (!window.confirm(CONFIRMATION)) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/admin/products/${productId}/draft-deletion`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      setError(typeof body.error === "string" ? body.error : "No se pudo eliminar el borrador.");
      return;
    }
    router.replace("/productos");
    router.refresh();
  };

  if (!eligible) return null;
  return <section className="draft-delete-panel" aria-label="Eliminar borrador técnico">
    <div><strong>Eliminar borrador técnico</strong><p>Disponible únicamente porque no tiene stock ni referencias históricas.</p></div>
    <button type="button" className="draft-delete-button" disabled={busy} onClick={() => void remove()}>{busy ? "Eliminando…" : "Eliminar draft"}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
