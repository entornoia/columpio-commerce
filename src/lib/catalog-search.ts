import type { SupabaseClient } from "@supabase/supabase-js";
import { mapProduct } from "./catalog";
import type { Product, Variant } from "./types";

export type CatalogSearchFilters = {
  query?: string;
  category?: string;
  subcategory?: string;
  color?: string;
  size?: string;
  style?: string;
  season?: string;
  formality?: string;
  fit?: string;
  material?: string;
  occasion?: string;
  active?: boolean;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
};

export type CatalogSearchResult = Omit<Product, "variants"> & {
  compatibleVariants: Variant[];
  compatibleStock: number;
  primaryImage: Product["images"][number] | null;
};

const normalized = (value: string) => value.trim().toLocaleLowerCase("es-CL");
const equals = (value: string, filter?: string) => !filter?.trim() || normalized(value) === normalized(filter);
const includes = (value: string, filter?: string) => !filter?.trim() || normalized(value).includes(normalized(filter));

/**
 * Deterministic, side-effect-free catalog filtering. It never invents or
 * aggregates data beyond the Product records supplied by the data source.
 */
export function filterCatalogProducts(
  products: Product[],
  filters: CatalogSearchFilters = {},
): CatalogSearchResult[] {
  const active = filters.active ?? true;
  const hasVariantFilter = Boolean(filters.color?.trim() || filters.size?.trim() || filters.inStock);

  return products.flatMap((product) => {
    if (product.active !== active) return [];
    if (!equals(product.category, filters.category)) return [];
    if (!equals(product.subcategory, filters.subcategory)) return [];
    if (!equals(product.style, filters.style)) return [];
    if (!equals(product.season, filters.season)) return [];
    if (!equals(product.formality, filters.formality)) return [];
    if (!equals(product.fit, filters.fit)) return [];
    if (!includes(product.material, filters.material)) return [];
    if (filters.occasion?.trim() && !product.occasions.some((occasion) => equals(occasion, filters.occasion))) return [];
    if (filters.minPrice !== undefined && product.price < filters.minPrice) return [];
    if (filters.maxPrice !== undefined && product.price > filters.maxPrice) return [];

    if (filters.query?.trim()) {
      const queryFields = [product.sku, product.name, product.description];
      if (!queryFields.some((field) => includes(field, filters.query))) return [];
    }

    const { variants, ...productData } = product;
    const compatibleVariants = variants.filter((variant) =>
      variant.active &&
      equals(variant.color, filters.color) &&
      equals(variant.size, filters.size) &&
      (!filters.inStock || variant.stock > 0),
    );

    if (hasVariantFilter && compatibleVariants.length === 0) return [];

    return [{
      ...productData,
      compatibleVariants,
      compatibleStock: compatibleVariants.reduce((total, variant) => total + variant.stock, 0),
      primaryImage: product.images[0] ?? null,
    }];
  });
}

/** Reusable data-access entry point for UI, server actions, API routes or tools. */
export async function searchCatalog(
  supabase: SupabaseClient,
  filters: CatalogSearchFilters = {},
): Promise<CatalogSearchResult[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*, product_variants(*), product_images(*)")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`No se pudo buscar en el catálogo: ${error.message}`);
  const products = (data ?? []).map((row) => mapProduct(row as never));
  return filterCatalogProducts(products, filters);
}
