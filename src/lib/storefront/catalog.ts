import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PublicCatalogCategory, PublicCatalogImage, PublicCatalogProduct, PublicCatalogVariant } from "./catalog-types";

type RpcRow = Record<string, unknown>;

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function array<T>(value: unknown) { return Array.isArray(value) ? value as T[] : []; }
function images(value: unknown): PublicCatalogImage[] {
  return array<RpcRow>(value).map((image) => ({ url: text(image.url), alt: text(image.alt), position: Number(image.position) || 0 }));
}
function variants(value: unknown): PublicCatalogVariant[] {
  return array<RpcRow>(value).map((variant) => ({ color: text(variant.color), size: text(variant.size), available: variant.available === true }));
}

function mapProduct(row: RpcRow): PublicCatalogProduct {
  const productVariants = variants(row.variants);
  return {
    id: text(row.id), brandSlug: text(row.brand_slug), brandName: text(row.brand_name) || undefined,
    categorySlug: text(row.category_slug), categoryName: text(row.category_name), slug: text(row.slug), name: text(row.name),
    shortDescription: text(row.short_description), description: text(row.description), price: Number(row.price),
    style: text(row.style), material: text(row.material), isAvailable: row.is_available === true,
    colors: array<string>(row.colors).filter(Boolean), sizes: array<string>(row.sizes).filter(Boolean),
    variants: productVariants, images: images(row.images), seoTitle: text(row.seo_title) || undefined,
    seoDescription: text(row.seo_description) || undefined, publishedAt: text(row.published_at),
  };
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(`No se pudo consultar el catálogo público (${name}): ${error.message}`);
  return (data ?? []) as T[];
}

export const listPublicCategories = cache(async (): Promise<PublicCatalogCategory[]> => {
  const rows = await rpc<RpcRow>("list_public_categories", { p_brand_slug: "mujer" });
  return rows.map((row) => ({ id: text(row.id), slug: text(row.slug), name: text(row.name), description: text(row.description), sortPosition: Number(row.sort_position), productCount: Number(row.product_count) }));
});

export const listPublicProducts = cache(async (categorySlug?: string, limit = 24): Promise<PublicCatalogProduct[]> => {
  const rows = await rpc<RpcRow>("list_public_products", { p_category_slug: categorySlug ?? null, p_limit: limit });
  return rows.map((row) => {
    const product = mapProduct(row);
    return { ...product, variants: [], colors: array<string>(row.colors), sizes: array<string>(row.sizes) };
  });
});

export const getPublicProductBySlug = cache(async (slug: string): Promise<PublicCatalogProduct | null> => {
  const rows = await rpc<RpcRow>("get_public_product_by_slug", { p_slug: slug, p_brand_slug: "mujer" });
  return rows[0] ? mapProduct(rows[0]) : null;
});
