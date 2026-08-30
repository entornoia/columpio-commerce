"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Product, ProductInput, PublicationStatus, Variant } from "@/lib/types";
import { useCatalog } from "./catalog-provider";
import { Icon } from "./icons";
import { ProductImageManager } from "./product-image-manager";

const emptyVariant = (): Variant => ({ id: crypto.randomUUID(), variantSku: "", color: "", size: "", stock: 0, active: true });
const emptyProduct: ProductInput = { sku: "", name: "", description: "", category: "", subcategory: "", price: 0, style: "", season: "", formality: "", fit: "", material: "", occasions: [], active: true, brandId: "", categoryId: null, slug: "", shortDescription: "", publicationStatus: "draft", publishedAt: null, seoTitle: "", seoDescription: "", variants: [emptyVariant()], images: [] };

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const { brands, categories, saveProduct, publishProduct } = useCatalog();
  const [form, setForm] = useState<ProductInput>(product ? { ...product, variants: product.variants.map((item) => ({ ...item })), occasions: [...product.occasions] } : emptyProduct);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const updateVariant = (id: string, key: keyof Variant, value: string | number | boolean) => set("variants", form.variants.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSaving(true);
    const result = await saveProduct(form, product?.id);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    router.push("/productos");
  };
  const publish = async () => {
    if (!product?.id) return setError("Guarda el producto antes de publicarlo.");
    setError(""); setPublishing(true);
    const result = await publishProduct(product.id);
    setPublishing(false);
    if (!result.ok) return setError(result.message);
    router.push("/productos");
  };
  return <form onSubmit={submit} className="product-form">
    {error && <div className="form-error">{error}</div>}
    <section className="form-section"><div className="section-heading"><span>01</span><div><h2>Información del producto</h2><p>Datos principales para identificar y organizar la prenda.</p></div></div>
      <div className="form-grid">
        <label>SKU <input required value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="CM-004" /></label>
        <label>Nombre <input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nombre del producto" /></label>
        <label>Marca <select required value={form.brandId} onChange={(e) => { set("brandId", e.target.value); set("categoryId", null); }}><option value="">Seleccionar marca</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <label>Categoría normalizada <select value={form.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)}><option value="">Sin mapear</option>{categories.filter((category) => !form.brandId || category.brandId === form.brandId).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Slug público <input required value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="vestido-alba" /><small>Minúsculas, sin tildes y separado por guiones.</small></label>
        <label>Estado editorial <select value={form.publicationStatus} onChange={(e) => set("publicationStatus", e.target.value as PublicationStatus)} disabled={form.publicationStatus === "published"}><option value="draft">Borrador</option><option value="ready">Listo para publicar</option>{form.publicationStatus === "published" && <option value="published">Publicado</option>}<option value="archived">Archivado</option></select></label>
        <label className="span-2">Descripción corta <textarea value={form.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} placeholder="Resumen breve para cards y colecciones" /></label>
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
      {product ? <ProductImageManager productId={product.id} productName={form.name} images={form.images} onChange={(images) => set("images", images)}/> : <div className="image-manager-empty"><strong>Guarda primero el producto</strong><p>Después podrás cargar fotografías usando su identificador definitivo.</p></div>}
      <div className="form-grid"><label className="toggle-label"><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} /><span/> Producto activo</label></div>
      <div className="form-grid"><label>Título SEO <input value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} placeholder="Título para buscadores" /></label><label>Descripción SEO <textarea value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} placeholder="Descripción para buscadores y redes" /></label></div>
    </section>
    {product && form.publicationStatus !== "published" && <p className="form-help">Guarda primero cualquier cambio pendiente. Publicar valida la versión actualmente guardada.</p>}
    <div className="form-actions"><button type="button" className="text-button" onClick={() => router.back()}>Cancelar</button>{product && form.publicationStatus !== "published" && <button className="secondary-button" type="button" disabled={saving || publishing} onClick={() => void publish()}>{publishing ? "Publicando…" : "Publicar explícitamente"}</button>}<button className="primary-button" type="submit" disabled={saving || publishing}>{saving ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}<Icon name="arrow" size={18}/></button></div>
  </form>;
}
