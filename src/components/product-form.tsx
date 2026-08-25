"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Product, ProductInput, Variant } from "@/lib/types";
import { useCatalog } from "./catalog-provider";
import { Icon } from "./icons";

const emptyVariant = (): Variant => ({ id: crypto.randomUUID(), variantSku: "", color: "", size: "", stock: 0, active: true });
const emptyProduct: ProductInput = { sku: "", name: "", description: "", category: "", subcategory: "", price: 0, style: "", season: "", formality: "", fit: "", material: "", occasions: [], active: true, variants: [emptyVariant()], images: [] };

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const { saveProduct } = useCatalog();
  const [form, setForm] = useState<ProductInput>(product ? { ...product, variants: product.variants.map((item) => ({ ...item })), occasions: [...product.occasions] } : emptyProduct);
  const [error, setError] = useState("");
  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateVariant = (id: string, key: keyof Variant, value: string | number | boolean) => set("variants", form.variants.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError("");
    const result = saveProduct(form, product?.id);
    if (!result.ok) return setError(result.message);
    router.push("/productos");
  };
  return <form onSubmit={submit} className="product-form">
    {error && <div className="form-error">{error}</div>}
    <section className="form-section"><div className="section-heading"><span>01</span><div><h2>Información del producto</h2><p>Datos principales para identificar y organizar la prenda.</p></div></div>
      <div className="form-grid">
        <label>SKU <input required value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="CM-004" /></label>
        <label>Nombre <input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nombre del producto" /></label>
        <label className="span-2">Descripción <textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe la prenda, su caída y detalles relevantes" /></label>
        <label>Categoría <input required value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Ej. Chaquetas" /></label>
        <label>Subcategoría <input value={form.subcategory} onChange={(e) => set("subcategory", e.target.value)} placeholder="Ej. Blazers" /></label>
        <label>Precio (CLP) <input required type="number" min="0" value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></label>
        <label>Material <input value={form.material} onChange={(e) => set("material", e.target.value)} placeholder="Ej. Lino y viscosa" /></label>
        <label>Estilo <input value={form.style} onChange={(e) => set("style", e.target.value)} placeholder="Ej. Minimalista" /></label>
        <label>Temporada <input value={form.season} onChange={(e) => set("season", e.target.value)} placeholder="Ej. Todo el año" /></label>
        <label>Formalidad <input value={form.formality} onChange={(e) => set("formality", e.target.value)} placeholder="Ej. Semi formal" /></label>
        <label>Fit <input value={form.fit} onChange={(e) => set("fit", e.target.value)} placeholder="Ej. Regular" /></label>
        <label className="span-2">Ocasiones <input value={form.occasions.join(", ")} onChange={(e) => set("occasions", e.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Oficina, cena, evento" /><small>Separa cada ocasión con una coma.</small></label>
      </div>
    </section>
    <section className="form-section"><div className="section-heading"><span>02</span><div><h2>Variantes y stock</h2><p>Cada combinación debe tener un SKU único y stock no negativo.</p></div></div>
      <div className="variant-list">{form.variants.map((item, index) => <div className="variant-row" key={item.id}><strong>Variante {index + 1}</strong><label>SKU<input required value={item.variantSku} onChange={(e) => updateVariant(item.id, "variantSku", e.target.value)} placeholder={`${form.sku || "CM-000"}-NEG-S`} /></label><label>Color<input required value={item.color} onChange={(e) => updateVariant(item.id, "color", e.target.value)} placeholder="Negro" /></label><label>Talla<input required value={item.size} onChange={(e) => updateVariant(item.id, "size", e.target.value)} placeholder="S" /></label><label>Stock<input required type="number" min="0" step="1" value={item.stock} onChange={(e) => updateVariant(item.id, "stock", Number(e.target.value))} /></label>{form.variants.length > 1 && <button type="button" className="remove" onClick={() => set("variants", form.variants.filter((variant) => variant.id !== item.id))} aria-label="Eliminar variante">×</button>}</div>)}</div>
      <button type="button" className="secondary-button" onClick={() => set("variants", [...form.variants, emptyVariant()])}><Icon name="plus" size={17}/> Agregar otra variante</button>
    </section>
    <section className="form-section"><div className="section-heading"><span>03</span><div><h2>Imágenes y estado</h2><p>Estructura preparada para URLs de imágenes de Supabase Storage.</p></div></div>
      <div className="form-grid"><label className="span-2">URL de imagen principal <input type="url" value={form.images[0]?.imageUrl ?? ""} onChange={(e) => set("images", e.target.value ? [{ id: form.images[0]?.id ?? crypto.randomUUID(), imageUrl: e.target.value, position: 0, altText: form.name }] : [])} placeholder="https://..." /></label><label className="toggle-label"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /><span/> Producto activo</label></div>
    </section>
    <div className="form-actions"><button type="button" className="text-button" onClick={() => router.back()}>Cancelar</button><button className="primary-button" type="submit">{product ? "Guardar cambios" : "Crear producto"}<Icon name="arrow" size={18}/></button></div>
  </form>;
}

