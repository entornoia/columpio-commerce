"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CatalogBrand, CatalogCategory, Product, ProductInput } from "@/lib/types";
import { mapBrand, mapCategory, mapProduct, toRpcPayload } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

type CatalogContextValue = {
  products: Product[];
  brands: CatalogBrand[];
  categories: CatalogCategory[];
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  saveProduct: (input: ProductInput, id?: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  publishProduct: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);
export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [brands, setBrands] = useState<CatalogBrand[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    if (!isSupabaseConfigured()) {
      setProducts([]);
      setBrands([]); setCategories([]);
      setError("Falta configurar la conexión a Supabase en .env.local.");
      setReady(true);
      return;
    }
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setProducts([]);
      setBrands([]); setCategories([]);
      setError("La sesión administrativa no es válida. Vuelve a iniciar sesión.");
      setReady(true);
      return;
    }
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError || claimsData?.claims?.role !== "authenticated") {
      setProducts([]);
      setBrands([]); setCategories([]);
      setError("La sesión no tiene el rol authenticated requerido para consultar el catálogo.");
      setReady(true);
      return;
    }
    const [productsResult, brandsResult, categoriesResult] = await Promise.all([
      supabase.from("products").select("*, product_variants(*), product_images(*)").order("created_at", { ascending: false }),
      supabase.from("brands").select("id, code, name, slug, active").order("name"),
      supabase.from("categories").select("id, brand_id, parent_id, code, name, slug, description, position, active").order("position"),
    ]);
    const { data, error: queryError } = productsResult;
    if (queryError) {
      setProducts([]);
      setBrands([]); setCategories([]);
      setError(`No se pudo cargar el catálogo: ${queryError.message}`);
    } else {
      setProducts((data ?? []).map((row) => mapProduct(row as never)));
      // Durante el intervalo previo a aplicar 014, el catálogo legacy sigue operativo.
      setBrands((brandsResult.data ?? []).map((row) => mapBrand(row as Record<string, unknown>)));
      setCategories((categoriesResult.data ?? []).map((row) => mapCategory(row as Record<string, unknown>)));
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
      if (saveError.code === "23505") return { ok: false, message: "El SKU de producto, variante o slug público ya existe o fue usado anteriormente." };
      if (saveError.code === "23514") return { ok: false, message: "Precio, stock o posición contienen un valor no permitido." };
      return { ok: false, message: `No se pudo guardar: ${saveError.message}` };
    }
    await refresh();
    return { ok: true, id: String(data) };
  };

  const publishProduct: CatalogContextValue["publishProduct"] = async (id) => {
    if (!isSupabaseConfigured()) return { ok: false, message: "Falta configurar Supabase en .env.local." };
    const { error: publishError } = await createClient().rpc("publish_catalog_product", { p_product_id: id });
    if (publishError) return { ok: false, message: `No se pudo publicar: ${publishError.message}` };
    await refresh();
    return { ok: true };
  };

  return <CatalogContext.Provider value={{ products, brands, categories, ready, error, refresh, saveProduct, publishProduct }}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog debe usarse dentro de CatalogProvider");
  return context;
}
