"use client";
import { use } from "react";
import Link from "next/link";
import { ProductForm } from "@/components/product-form";
import { useCatalog } from "@/components/catalog-provider";
export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); const { products, ready, error } = useCatalog(); const product = products.find((item) => item.id === id); if (!ready) return <div className="page-wrap loading-state">Cargando producto desde Supabase…</div>; if (error) return <div className="page-wrap error-state"><h1>Error al cargar el producto</h1><p>{error}</p></div>; if (!product) return <div className="page-wrap empty-page"><h1>Producto no encontrado</h1><Link href="/productos">Volver a productos</Link></div>; return <div className="page-wrap form-page"><header className="page-header"><div><span className="eyebrow">{product.sku} · EDICIÓN</span><h1>Editar {product.name}</h1><p>Actualiza información, variantes, stock y estado.</p></div></header><ProductForm product={product}/></div>; }
