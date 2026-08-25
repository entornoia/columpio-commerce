"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { ProductArt } from "@/components/product-art";
import { useCatalog } from "@/components/catalog-provider";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export default function ProductsPage() {
  const { products, ready, error, refresh } = useCatalog(); const [query, setQuery] = useState(""); const [status, setStatus] = useState("Todos");
  const filtered = useMemo(() => products.filter((p) => (`${p.sku} ${p.name} ${p.category}`).toLowerCase().includes(query.toLowerCase()) && (status === "Todos" || (status === "Activos" ? p.active : !p.active))), [products, query, status]);
  if (!ready) return <div className="page-wrap loading-state">Cargando productos desde Supabase…</div>;
  if (error) return <div className="page-wrap error-state"><h1>Error al cargar productos</h1><p>{error}</p><button className="secondary-button" onClick={() => void refresh()}>Reintentar</button></div>;
  return <div className="page-wrap"><header className="page-header"><div><span className="eyebrow">CATÁLOGO</span><h1>Productos</h1><p>{products.length} productos registrados en Columpio Mujer.</p></div><Link href="/productos/nuevo" className="primary-button"><Icon name="plus" size={18}/> Agregar producto</Link></header>
    <div className="toolbar"><label className="search"><Icon name="search" size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, SKU o categoría" /></label><div className="filter-tabs">{["Todos", "Activos", "Inactivos"].map((item) => <button key={item} className={status === item ? "active" : ""} onClick={() => setStatus(item)}>{item}</button>)}</div></div>
    <div className="product-table"><div className="table-head"><span>Producto</span><span>Categoría</span><span>Precio</span><span>Variantes</span><span>Stock</span><span>Estado</span><span/></div>{filtered.map((product, index) => { const stock = product.variants.reduce((sum, item) => sum + item.stock, 0); return <div className="table-row" key={product.id}><div className="product-cell"><ProductArt index={index} imageUrl={product.images[0]?.imageUrl} alt={product.images[0]?.altText || product.name}/><div><strong>{product.name}</strong><small>{product.sku}</small></div></div><span>{product.category}</span><b>{money.format(product.price)}</b><span>{product.variants.length}</span><span className={stock <= 3 ? "low-stock" : ""}>{stock} un.</span><span><i className={product.active ? "badge active" : "badge"}>{product.active ? "Activo" : "Inactivo"}</i></span><Link className="edit-link" href={`/productos/${product.id}/editar`} aria-label={`Editar ${product.name}`}><Icon name="edit" size={17}/></Link></div>})}{filtered.length === 0 && <div className="empty-state">No hay productos para mostrar con los filtros actuales.</div>}</div>
  </div>;
}
