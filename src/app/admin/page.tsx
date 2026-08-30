"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { ProductArt } from "@/components/product-art";
import { useCatalog } from "@/components/catalog-provider";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export default function Dashboard() {
  const { products, ready, error } = useCatalog();
  const stock = products.reduce((sum, product) => sum + product.variants.reduce((subtotal, item) => subtotal + item.stock, 0), 0);
  const lowStock = products.reduce((sum, product) => sum + product.variants.filter((item) => item.stock <= 2).length, 0);
  if (!ready) return <div className="page-wrap loading-state">Cargando catálogo desde Supabase…</div>;
  if (error) return <div className="page-wrap error-state"><h1>No pudimos cargar el catálogo</h1><p>{error}</p></div>;
  return <div className="page-wrap">
    <header className="page-header"><div><span className="eyebrow">CATÁLOGO · BLOQUE 1A</span><h1>Buenos días, Columpio.</h1><p>Aquí tienes una vista clara del catálogo y su disponibilidad.</p></div><Link href="/productos/nuevo" className="primary-button"><Icon name="plus" size={18}/> Agregar producto</Link></header>
    <section className="metrics"><article><span>PRODUCTOS</span><strong>{products.length}</strong><small>{products.filter((p) => p.active).length} activos</small></article><article><span>UNIDADES EN STOCK</span><strong>{stock}</strong><small>En todas las variantes</small></article><article><span>STOCK BAJO</span><strong>{lowStock}</strong><small>Variantes con 2 o menos</small></article></section>
    <section className="dashboard-grid"><div className="panel"><div className="panel-title"><div><span className="eyebrow">RECIENTES</span><h2>Productos del catálogo</h2></div><Link href="/productos">Ver todos <Icon name="arrow" size={16}/></Link></div><div className="recent-list">{products.slice(0, 3).map((product, index) => <Link href={`/productos/${product.id}/editar`} key={product.id} className="recent-item"><ProductArt index={index} imageUrl={product.images[0]?.imageUrl} alt={product.images[0]?.altText || product.name}/><div><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div><b>{money.format(product.price)}</b><em>{product.variants.reduce((sum, item) => sum + item.stock, 0)} un.</em></Link>)}</div></div><aside className="quick-panel"><span className="eyebrow">ACCESO RÁPIDO</span><h2>Gestiona tu catálogo</h2><p>Mantén los datos de productos, variantes y stock al día.</p><Link href="/productos"><Icon name="box"/> Revisar productos <Icon name="arrow" size={17}/></Link><Link href="/productos/nuevo"><Icon name="plus"/> Crear producto <Icon name="arrow" size={17}/></Link></aside></section>
  </div>;
}
