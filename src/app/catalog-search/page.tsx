"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ProductArt } from "@/components/product-art";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { CatalogSearchFilters, CatalogSearchResult, searchCatalog } from "@/lib/catalog-search";

type SearchForm = Record<"query" | "category" | "subcategory" | "color" | "size" | "style" | "season" | "formality" | "fit" | "material" | "occasion" | "minPrice" | "maxPrice", string> & { inStock: boolean };

const initialForm: SearchForm = {
  query: "", category: "", subcategory: "", color: "", size: "", style: "",
  season: "", formality: "", fit: "", material: "", occasion: "",
  minPrice: "", maxPrice: "", inStock: false,
};
const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function toFilters(form: SearchForm): CatalogSearchFilters {
  return {
    query: form.query, category: form.category, subcategory: form.subcategory,
    color: form.color, size: form.size, style: form.style, season: form.season,
    formality: form.formality, fit: form.fit, material: form.material,
    occasion: form.occasion, inStock: form.inStock,
    minPrice: form.minPrice === "" ? undefined : Number(form.minPrice),
    maxPrice: form.maxPrice === "" ? undefined : Number(form.maxPrice),
  };
}

export default function CatalogSearchPage() {
  const [form, setForm] = useState<SearchForm>(initialForm);
  const [applied, setApplied] = useState<SearchForm>(initialForm);
  const [results, setResults] = useState<CatalogSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const runSearch = useCallback(async (nextForm: SearchForm) => {
    setLoading(true); setError(""); setApplied(nextForm);
    try { setResults(await searchCatalog(createClient(), toFilters(nextForm))); }
    catch (searchError) { setResults([]); setError(searchError instanceof Error ? searchError.message : "Error desconocido al buscar."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => void runSearch(initialForm)); }, [runSearch]);
  const set = (key: keyof SearchForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); void runSearch(form); };
  const clear = () => { setForm(initialForm); void runSearch(initialForm); };
  const activeFilters = Object.entries(applied).filter(([, value]) => value !== "" && value !== false);

  return <div className="page-wrap search-page">
    <header className="page-header"><div><span className="eyebrow">CATÁLOGO · BÚSQUEDA ESTRUCTURADA</span><h1>Explorar catálogo</h1><p>Consulta datos objetivos de productos y variantes almacenados en Supabase.</p></div></header>
    <form className="search-filters" onSubmit={submit}>
      <label className="filter-query"><span>Texto libre</span><div><Icon name="search" size={17}/><input value={form.query} onChange={(event) => set("query", event.target.value)} placeholder="SKU, nombre o descripción" /></div></label>
      {([
        ["category", "Categoría", "Ej. Chaquetas"], ["subcategory", "Subcategoría", "Ej. Blazers"],
        ["color", "Color", "Ej. Negro"], ["size", "Talla", "Ej. M"],
        ["style", "Estilo", "Ej. Clásico"], ["season", "Temporada", "Ej. Todo el año"],
        ["formality", "Formalidad", "Ej. Semi formal"], ["fit", "Fit", "Ej. Regular"],
        ["material", "Material", "Ej. Viscosa"], ["occasion", "Ocasión", "Ej. Oficina"],
      ] as const).map(([key, label, placeholder]) => <label key={key}><span>{label}</span><input value={form[key]} onChange={(event) => set(key, event.target.value)} placeholder={placeholder}/></label>)}
      <label><span>Precio mínimo</span><input type="number" min="0" value={form.minPrice} onChange={(event) => set("minPrice", event.target.value)} placeholder="$0"/></label>
      <label><span>Precio máximo</span><input type="number" min="0" value={form.maxPrice} onChange={(event) => set("maxPrice", event.target.value)} placeholder="Sin máximo"/></label>
      <label className="stock-filter"><input type="checkbox" checked={form.inStock} onChange={(event) => set("inStock", event.target.checked)}/><span>Solo variantes con stock</span></label>
      <div className="search-actions"><button type="button" className="text-button" onClick={clear}>Limpiar filtros</button><button className="primary-button" type="submit"><Icon name="search" size={17}/> Buscar catálogo</button></div>
    </form>

    <div className="search-summary"><div><strong>{loading ? "Buscando…" : `${results.length} ${results.length === 1 ? "producto encontrado" : "productos encontrados"}`}</strong><span>Solo productos activos por defecto</span></div>{activeFilters.length > 0 && <div className="active-filters"><small>FILTROS ACTIVOS</small>{activeFilters.map(([key, value]) => <span key={key}>{key}: {value === true ? "sí" : String(value)}</span>)}</div>}</div>
    {error && <div className="search-feedback error"><h2>Error de búsqueda</h2><p>{error}</p><button className="secondary-button" onClick={() => void runSearch(applied)}>Reintentar</button></div>}
    {!error && loading && <div className="search-feedback">Cargando resultados desde Supabase…</div>}
    {!error && !loading && results.length === 0 && <div className="search-feedback"><h2>0 resultados</h2><p>No hay productos activos que coincidan con esta combinación de filtros.</p><button className="secondary-button" onClick={clear}>Limpiar filtros</button></div>}
    {!error && !loading && results.length > 0 && <div className="search-results">{results.map((product, index) => <article className="search-result-card" key={product.id}>
      <div className="result-product"><ProductArt index={index} imageUrl={product.primaryImage?.imageUrl} alt={product.primaryImage?.altText || product.name}/><div><small>{product.sku}</small><h2>{product.name}</h2><p>{product.category}{product.subcategory ? ` · ${product.subcategory}` : ""}</p></div><strong>{money.format(product.price)}</strong></div>
      <div className="matching-variants"><div className="variant-result-head"><span>Variantes compatibles</span><strong>Stock compatible: {product.compatibleStock}</strong></div>{product.compatibleVariants.length === 0 ? <p className="no-variants">Producto sin variantes activas.</p> : product.compatibleVariants.map((variant) => <div className="matching-variant" key={variant.id}><span>{variant.variantSku}</span><b>{variant.color}</b><b>Talla {variant.size}</b><em className={variant.stock === 0 ? "out" : ""}>{variant.stock} un.</em></div>)}</div>
    </article>)}</div>}
  </div>;
}

