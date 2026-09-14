"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ProductAction = "delete" | "deactivate" | "reactivate" | "none";
type ManagementState = {
  exists: boolean;
  eligible: boolean;
  action: ProductAction;
  actionAvailable: boolean;
  active: boolean;
  publicationStatus: string;
  setupStatus: string;
  blockers: string[];
};

const DELETE_CONFIRMATION = "Este producto se eliminará definitivamente. Esta acción no se puede deshacer.";
const DEACTIVATE_CONFIRMATION = "Este producto dejará de estar disponible en la tienda, pero se conservará su historial.";

export function ProductManagementPanel({ productId, onChanged }: { productId: string; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [management, setManagement] = useState<ManagementState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/products/${productId}/management`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "No se pudo verificar el producto.");
    setManagement(body.management as ManagementState);
  }, [productId]);

  useEffect(() => {
    queueMicrotask(() => void load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo verificar el producto.")));
  }, [load]);

  const remove = async () => {
    if (!window.confirm(DELETE_CONFIRMATION)) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/products/${productId}/management`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setBusy(false); setError(typeof body.error === "string" ? body.error : "No se pudo eliminar el producto."); return; }
    router.replace("/productos"); router.refresh();
  };

  const changeLifecycle = async (action: "deactivate" | "reactivate") => {
    if (action === "deactivate" && !window.confirm(DEACTIVATE_CONFIRMATION)) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/products/${productId}/management`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setBusy(false); setError(typeof body.error === "string" ? body.error : "No se pudo actualizar el producto."); return; }
    await onChanged(); await load(); router.refresh(); setBusy(false);
  };

  const action = management?.action ?? "none";
  const copy = management?.eligible
    ? "Este producto puede eliminarse porque nunca ha tenido actividad comercial."
    : management?.active
      ? "Este producto tiene historial o condiciones que impiden eliminarlo. Puedes desactivarlo para retirarlo de la tienda."
      : management?.actionAvailable
        ? "Este producto está desactivado. Puedes reactivarlo sin publicarlo automáticamente."
        : "Este producto está incompleto. Debes completar su ficha antes de reactivarlo.";

  return <section className={`product-management-panel ${action === "delete" ? "danger" : ""}`} aria-label="Gestión del producto">
    <div className="product-management-copy">
      <span className="eyebrow">GESTIÓN</span>
      <h2>Gestión del producto</h2>
      {management && <p className="product-management-state">Estado actual: <strong>{management.active ? "Activo" : "Inactivo"}</strong> · {publicationLabel(management.publicationStatus)}</p>}
      <p>{management ? copy : "Comprobando actividad e historial del producto…"}</p>
    </div>
    {action === "delete" && <button type="button" className="product-management-danger" disabled={busy} onClick={() => void remove()}>{busy ? "Eliminando…" : "Eliminar producto"}</button>}
    {action === "deactivate" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void changeLifecycle("deactivate")}>{busy ? "Desactivando…" : "Desactivar producto"}</button>}
    {action === "reactivate" && <button type="button" className="secondary-button" disabled={busy || !management?.actionAvailable} onClick={() => void changeLifecycle("reactivate")}>{busy ? "Reactivando…" : "Reactivar producto"}</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

function publicationLabel(status: string) {
  return ({ draft: "Borrador", ready: "Listo para publicar", published: "Publicado", archived: "Archivado" } as Record<string, string>)[status] ?? status;
}
