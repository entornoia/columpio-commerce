"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { seedProducts } from "@/lib/seed";
import { Product, ProductInput } from "@/lib/types";

type CatalogContextValue = {
  products: Product[];
  ready: boolean;
  saveProduct: (input: ProductInput, id?: string) => { ok: true; id: string } | { ok: false; message: string };
};

const CatalogContext = createContext<CatalogContextValue | null>(null);
const storageKey = "columpio-commerce-products-v1";

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>(seedProducts);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) {
        try { setProducts(JSON.parse(stored) as Product[]); } catch { window.localStorage.removeItem(storageKey); }
      }
      setReady(true);
    });
  }, []);

  useEffect(() => { if (ready) window.localStorage.setItem(storageKey, JSON.stringify(products)); }, [products, ready]);

  const saveProduct: CatalogContextValue["saveProduct"] = (input, id) => {
    const sku = input.sku.trim().toUpperCase();
    const variants = input.variants.map((item) => ({ ...item, variantSku: item.variantSku.trim().toUpperCase(), stock: Number(item.stock) }));
    if (products.some((product) => product.id !== id && product.sku.toUpperCase() === sku)) return { ok: false, message: "El SKU del producto ya existe." };
    const variantSkus = variants.map((item) => item.variantSku);
    if (new Set(variantSkus).size !== variantSkus.length) return { ok: false, message: "Los SKU de variantes no pueden repetirse." };
    if (products.some((product) => product.id !== id && product.variants.some((item) => variantSkus.includes(item.variantSku.toUpperCase())))) return { ok: false, message: "Uno de los SKU de variante ya existe en el catálogo." };
    if (variants.some((item) => item.stock < 0 || !Number.isInteger(item.stock))) return { ok: false, message: "El stock debe ser un número entero igual o mayor que cero." };
    const timestamp = new Date().toISOString();
    const productId = id ?? crypto.randomUUID();
    const product: Product = { ...input, sku, variants, id: productId, createdAt: products.find((item) => item.id === id)?.createdAt ?? timestamp, updatedAt: timestamp };
    setProducts((current) => id ? current.map((item) => item.id === id ? product : item) : [product, ...current]);
    return { ok: true, id: productId };
  };

  return <CatalogContext.Provider value={{ products, ready, saveProduct }}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog debe usarse dentro de CatalogProvider");
  return context;
}
