"use client";

import { ChangeEvent, useMemo, useState } from "react";
import type { ProductImage } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { PRODUCT_IMAGE_BUCKET, uploadProductImage, validateProductImageFile } from "@/lib/product-image-upload";

type UploadItem = { id: string; name: string; preview: string; status: string; error?: string };

export function ProductImageManager({ productId, productName, images, onChange }: {
  productId: string; productName: string; images: ProductImage[]; onChange: (images: ProductImage[]) => void;
}) {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const readyImages = useMemo(() => images.filter((image) => image.status === "ready").sort((a, b) => a.position - b.position), [images]);
  const patchUpload = (id: string, patch: Partial<UploadItem>) => setUploads((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const uploadOne = async (file: File, localId: string): Promise<ProductImage> => {
    return uploadProductImage({ file, productId, productName, onStatus: (status) => patchUpload(localId, { status }) });
  };

  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; event.target.value = "";
    if (!files.length) return;
    setError(""); setBusy(true);
    let accumulatedImages = [...readyImages];
    for (const file of files) {
      const localId = crypto.randomUUID(); const preview = URL.createObjectURL(file);
      setUploads((current) => [...current, { id: localId, name: file.name, preview, status: "Validando…" }]);
      const validationError = validateProductImageFile(file);
      if (validationError) { patchUpload(localId, { status: "Error", error: validationError }); URL.revokeObjectURL(preview); continue; }
      try {
        const uploadedImage = await uploadOne(file, localId);
        accumulatedImages = [...accumulatedImages, { ...uploadedImage, position: accumulatedImages.length }];
        onChange(accumulatedImages);
      }
      catch (uploadError) { patchUpload(localId, { status: "Error", error: uploadError instanceof Error ? uploadError.message : "No se pudo subir la imagen." }); }
      finally { URL.revokeObjectURL(preview); }
    }
    setBusy(false);
  };

  const reorder = async (next: ProductImage[]) => {
    setError(""); setBusy(true);
    const normalized = next.map((image, position) => ({ ...image, position }));
    const { error: reorderError } = await createClient().rpc("reorder_product_images", { p_product_id: productId, p_image_ids: normalized.map((image) => image.id) });
    setBusy(false);
    if (reorderError) return setError(`No se pudo reordenar: ${reorderError.message}`);
    onChange(normalized);
  };
  const move = (index: number, target: number) => {
    if (target < 0 || target >= readyImages.length) return;
    const next = [...readyImages]; const [image] = next.splice(index, 1); next.splice(target, 0, image); void reorder(next);
  };
  const updateAlt = async (image: ProductImage, altText: string) => {
    const { error: altError } = await createClient().rpc("update_product_image_alt", { p_image_id: image.id, p_alt_text: altText });
    if (altError) setError(`No se pudo guardar el texto alternativo: ${altError.message}`);
  };
  const remove = async (image: ProductImage) => {
    setError(""); setBusy(true); const supabase = createClient();
    const { data, error: beginError } = await supabase.rpc("begin_product_image_deletion", { p_image_id: image.id });
    if (beginError) { setBusy(false); return setError(`No se pudo iniciar la eliminación: ${beginError.message}`); }
    const row = Array.isArray(data) ? data[0] : data; const path = String(row?.storage_path ?? image.storagePath ?? "");
    if (path) {
      const { error: storageError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
      if (storageError) { await supabase.rpc("cancel_product_image_deletion", { p_image_id: image.id }); setBusy(false); return setError(`No se pudo eliminar el archivo: ${storageError.message}`); }
    }
    const { error: finalizeError } = await supabase.rpc("finalize_product_image_deletion", { p_image_id: image.id }); setBusy(false);
    if (finalizeError) return setError(`El archivo fue retirado, pero falta finalizar su registro: ${finalizeError.message}`);
    onChange(readyImages.filter((item) => item.id !== image.id).map((item, position) => ({ ...item, position })));
  };

  return <div className="image-manager">
    <label className="image-upload-button">Seleccionar imágenes<input type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={(event) => void selectFiles(event)}/></label>
    <small>JPEG, PNG o WebP · máximo 5 MiB por imagen.</small>{error && <div className="form-error">{error}</div>}
    {readyImages.length ? <div className="image-manager-grid">{readyImages.map((image, index) => <article key={image.id} className="image-manager-card">
      <div className="image-manager-preview" style={{ backgroundImage: `url("${image.imageUrl.replaceAll('"', "%22")}")` }}>{index === 0 && <b>Principal</b>}</div>
      <label>Texto alternativo<input value={image.altText} onChange={(event) => onChange(readyImages.map((item) => item.id === image.id ? { ...item, altText: event.target.value } : item))} onBlur={(event) => void updateAlt(image, event.target.value)} /></label>
      <div className="image-manager-actions"><button type="button" disabled={busy || index === 0} onClick={() => move(index, index - 1)}>← Antes</button><button type="button" disabled={busy || index === readyImages.length - 1} onClick={() => move(index, index + 1)}>Después →</button>{index > 0 && <button type="button" disabled={busy} onClick={() => move(index, 0)}>Hacer principal</button>}<button type="button" className="danger" disabled={busy} onClick={() => void remove(image)}>Eliminar</button></div>
    </article>)}</div> : <p className="image-manager-empty">Sin imágenes. El storefront mostrará el placeholder editorial.</p>}
    {uploads.length > 0 && <div className="image-upload-list">{uploads.map((upload) => <div key={upload.id}><span style={{ backgroundImage: `url("${upload.preview}")` }}/><p><strong>{upload.name}</strong><small>{upload.status}{upload.error ? ` · ${upload.error}` : ""}</small></p></div>)}</div>}
  </div>;
}
