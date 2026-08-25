"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Product, ProductInput } from "@/lib/types";
import { mapProduct, toRpcPayload } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type CatalogContextValue = {
  products: Product[];
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  saveProduct: (input: ProductInput, id?: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);
export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    if (!isSupabaseConfigured()) {
      setProducts([]);
      setError("Falta configurar la conexión a Supabase en .env.local.");
      setReady(true);
      return;
    }
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setProducts([]);
      setError("La sesión administrativa no es válida. Vuelve a iniciar sesión.");
      setReady(true);
      return;
    }
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || claimsData?.claims?.role !== "authenticated") {
      setProducts([]);
      setError("La sesión no tiene el rol authenticated requerido para consultar el catálogo.");
      setReady(true);
      return;
    }
    const { data, error: queryError } = await supabase
      .from("products")
      .select("*, product_variants(*), product_images(*)")
      .order("created_at", { ascending: false });
    if (queryError) {
      setProducts([]);
      setError(`No se pudo cargar el catálogo: ${queryError.message}`);
    } else {
      setProducts((data ?? []).map((row) => mapProduct(row as never)));
    }
    setReady(true);
  }, []);

  useEffect(() => { queueMicrotask(() => void refresh()); }, [refresh]);

  const saveProduct: CatalogContextValue["saveProduct"] = async (input, id) => {
    const variants = input.variants.map((item) => ({ ...item, variantSku: item.variantSku.trim().toUpperCase(), stock: Number(item.stock) }));
    const variantSkus = variants.map((item) => item.variantSku);
    if (new Set(variantSkus).size !== variantSkus.length) return { ok: false, message: "Los SKU de variantes no pueden repetirse." };
    if (variants.some((item) => item.stock < 0 || !Number.isInteger(item.stock))) return { ok: false, message: "El stock debe ser un número entero igual o mayor que cero." };
    if (!isSupabaseConfigured()) return { ok: false, message: "Falta configurar Supabase en .env.local." };
    const supabase = createClient();
    const { data, error: saveError } = await supabase.rpc("save_catalog_product", toRpcPayload({ ...input, variants }, id));
    if (saveError) {
      if (saveError.code === "23505") return { ok: false, message: "El SKU de producto o de variante ya existe." };
      if (saveError.code === "23514") return { ok: false, message: "Precio, stock o posición contienen un valor no permitido." };
      return { ok: false, message: `No se pudo guardar: ${saveError.message}` };
    }
    await refresh();
    return { ok: true, id: String(data) };
  };

  return <CatalogContext.Provider value={{ products, ready, error, refresh, saveProduct }}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog debe usarse dentro de CatalogProvider");
  return context;
}
