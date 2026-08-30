"use client";

import { ChangeEvent, useEffect, useState } from "react";
import type { CatalogProductAnalysis } from "@/lib/catalog-product-analysis";
import { mapProduct } from "@/lib/catalog";
import { uploadProductImage, validateProductImageFile } from "@/lib/product-image-upload";
import { createClient } from "@/lib/supabase/client";
import type { Product, ProductInput } from "@/lib/types";
import { ProductForm } from "./product-form";

type AnalysisResponse = {
  analysis: CatalogProductAnalysis;
  resolvedCategory: { id: string; slug: string; name: string } | null;
  suggestedSlug: string;
  model: string;
  estimatedCostUsd: number | null;
};

const value = (suggestion: { value: string | null }) => suggestion.value?.trim() ?? "";

export function ProductPhotoIntake() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [preparedProduct, setPreparedProduct] = useState<Product | null>(null);
  const [aiSuggestedFields, setAiSuggestedFields] = useState<(keyof ProductInput)[]>([]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = "";
    setError("");
    if (!selected) return;
    const validationError = validateProductImageFile(selected);
    if (validationError) return setError(validationError);
    if (preview) URL.revokeObjectURL(preview);
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
  };

  const loadPreparedProduct = async (productId: string, analysisResult: AnalysisResponse) => {
    const supabase = createClient();
    const { data, error: loadError } = await supabase.from("products")
      .select("*, product_variants(*), product_images(*)").eq("id", productId).single();
    if (loadError || !data) throw new Error(loadError?.message ?? "No se pudo recuperar el draft analizado.");
    const product = mapProduct(data as never);
    const analysis = analysisResult.analysis;
    const suggestedFields: (keyof ProductInput)[] = [];
    const markIfUncertain = (key: keyof ProductInput, suggestion: { confidence: string; basis: string; value: string | null }) => {
      if (suggestion.value && (suggestion.confidence === "low" || (suggestion.basis === "inferred" && suggestion.confidence !== "high"))) suggestedFields.push(key);
    };
    markIfUncertain("name", analysis.commercialName);
    markIfUncertain("subcategory", analysis.legacySubcategory);
    markIfUncertain("material", analysis.apparentMaterial);
    markIfUncertain("style", analysis.style);
    markIfUncertain("fit", analysis.fit);
    markIfUncertain("season", analysis.season);
    markIfUncertain("formality", analysis.formality);
    const suggestedColors = [value(analysis.primaryColor), ...analysis.secondaryColors.map(value)].filter(Boolean)
      .filter((color, index, colors) => colors.findIndex((candidate) => candidate.toLocaleLowerCase("es-CL") === color.toLocaleLowerCase("es-CL")) === index);

    setAiSuggestedFields(suggestedFields);
    setPreparedProduct({
      ...product,
      sku: "",
      name: value(analysis.commercialName),
      description: value(analysis.description),
      category: value(analysis.legacyCategory) || analysisResult.resolvedCategory?.name || "",
      subcategory: value(analysis.legacySubcategory),
      price: 0,
      style: value(analysis.style),
      season: value(analysis.season),
      formality: value(analysis.formality),
      fit: value(analysis.fit),
      material: value(analysis.apparentMaterial),
      occasions: analysis.occasions.map(value).filter(Boolean),
      active: false,
      categoryId: analysisResult.resolvedCategory?.id ?? null,
      slug: analysisResult.suggestedSlug,
      shortDescription: value(analysis.shortDescription),
      publicationStatus: "draft",
      publishedAt: null,
      seoTitle: value(analysis.seoTitle),
      seoDescription: value(analysis.seoDescription),
      setupStatus: "in_progress",
      analysisStatus: "completed",
      analysisModel: analysisResult.model,
      variants: (suggestedColors.length ? suggestedColors : [""]).map((color) => ({ id: crypto.randomUUID(), variantSku: "", color, size: "", stock: 0, active: true })),
    });
  };

  const analyze = async () => {
    if (!file && !imageId) return setError("Selecciona una fotografía antes de analizar.");
    setBusy(true); setError("");
    let currentDraftId = draftId;
    let currentImageId = imageId;
    try {
      const supabase = createClient();
      if (!currentDraftId) {
        setStatus("Preparando producto…");
        const { data, error: draftError } = await supabase.rpc("create_product_intake_draft");
        if (draftError || !data) throw new Error(draftError?.message ?? "No se pudo crear el draft técnico.");
        currentDraftId = String(data); setDraftId(currentDraftId);
      }
      if (!currentImageId) {
        if (!file) throw new Error("Selecciona nuevamente la fotografía para continuar.");
        const uploaded = await uploadProductImage({ file, productId: currentDraftId, productName: "Prenda en análisis", onStatus: setStatus });
        currentImageId = uploaded.id; setImageId(uploaded.id);
      }
      setStatus("Analizando prenda…");
      const response = await fetch("/api/catalog/product-analysis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: currentDraftId, imageId: currentImageId }),
      });
      const result = await response.json() as AnalysisResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo analizar la prenda.");
      await loadPreparedProduct(currentDraftId, result);
      setStatus("Análisis completado");
    } catch (analysisError) {
      setStatus("");
      setError(analysisError instanceof Error ? analysisError.message : "No se pudo completar el análisis.");
    } finally { setBusy(false); }
  };

  if (preparedProduct) return <div className="photo-intake-complete">
    <div className="analysis-success"><strong>Análisis completado</strong><span>Revisa, corrige o elimina cualquier sugerencia antes de guardar.</span></div>
    <ProductForm product={preparedProduct} intakeMode aiSuggestedFields={aiSuggestedFields}/>
  </div>;

  return <section className="photo-intake" aria-labelledby="photo-intake-title">
    <div className="photo-intake-copy">
      <span className="eyebrow">PRIMER PASO</span>
      <h2 id="photo-intake-title">Sube una foto de la prenda</h2>
      <p>La IA analizará la imagen para sugerir nombre, categoría, colores y una descripción editable.</p>
    </div>
    <label className={`photo-intake-dropzone${preview ? " has-preview" : ""}`}>
      {preview ? <span className="photo-intake-preview" role="img" aria-label="Vista previa de la prenda seleccionada" style={{ backgroundImage: `url("${preview.replaceAll('"', "%22")}")` }}/> : <span><b>Seleccionar imagen</b><small>JPEG, PNG o WebP · máximo 5 MiB</small></span>}
      <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={selectFile}/>
    </label>
    {preview && <button type="button" className="text-button" disabled={busy} onClick={() => { setFile(null); URL.revokeObjectURL(preview); setPreview(""); }}>Elegir otra foto</button>}
    {error && <div className="form-error">{error}</div>}
    {status && <p className="photo-intake-status">{status}</p>}
    <button type="button" className="primary-button photo-intake-analyze" disabled={busy || (!file && !imageId)} onClick={() => void analyze()}>
      {busy ? status || "Procesando…" : imageId ? "Reintentar análisis" : "Analizar prenda"}
    </button>
    <small className="photo-intake-note">Seleccionar una foto no crea registros. El draft técnico se crea únicamente al analizar.</small>
  </section>;
}
