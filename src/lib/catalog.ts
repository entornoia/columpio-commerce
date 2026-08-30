import type { CatalogBrand, CatalogCategory, Product, ProductAnalysisStatus, ProductInput, ProductSetupStatus, PublicationStatus } from "./types.ts";

type DbImage = {
  id: string; image_url: string; position: number; alt_text: string;
  storage_bucket?: string | null; storage_path?: string | null; mime_type?: string | null;
  width?: number | null; height?: number | null; file_size?: number | null;
  status?: "pending" | "ready" | "delete_pending" | "failed";
};
type DbVariant = { id: string; variant_sku: string; color: string; size: string; stock: number; active: boolean };
type DbProduct = {
  id: string; sku: string; name: string; description: string; category: string;
  subcategory: string; price: number | string; style: string; season: string;
  formality: string; fit: string; material: string; occasions: string[];
  active: boolean; created_at: string; updated_at: string;
  brand_id?: string; category_id?: string | null; slug?: string; short_description?: string;
  publication_status?: PublicationStatus; published_at?: string | null;
  seo_title?: string; seo_description?: string;
  setup_status?: ProductSetupStatus; setup_started_at?: string | null; setup_updated_at?: string | null;
  setup_expires_at?: string | null; analysis_status?: ProductAnalysisStatus;
  analysis_completed_at?: string | null; analysis_model?: string | null; analysis_error?: string | null;
  product_variants: DbVariant[]; product_images: DbImage[];
};

export function mapProduct(row: DbProduct): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category,
    subcategory: row.subcategory,
    price: Number(row.price),
    style: row.style,
    season: row.season,
    formality: row.formality,
    fit: row.fit,
    material: row.material,
    occasions: row.occasions ?? [],
    active: row.active,
    brandId: row.brand_id ?? "",
    categoryId: row.category_id ?? null,
    slug: row.slug ?? "",
    shortDescription: row.short_description ?? "",
    publicationStatus: row.publication_status ?? "draft",
    publishedAt: row.published_at ?? null,
    seoTitle: row.seo_title ?? "",
    seoDescription: row.seo_description ?? "",
    setupStatus: row.setup_status ?? "complete",
    setupStartedAt: row.setup_started_at ?? null,
    setupUpdatedAt: row.setup_updated_at ?? null,
    setupExpiresAt: row.setup_expires_at ?? null,
    analysisStatus: row.analysis_status ?? "not_started",
    analysisCompletedAt: row.analysis_completed_at ?? null,
    analysisModel: row.analysis_model ?? null,
    analysisError: row.analysis_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variants: (row.product_variants ?? []).map((variant) => ({
      id: variant.id,
      variantSku: variant.variant_sku,
      color: variant.color,
      size: variant.size,
      stock: variant.stock,
      active: variant.active,
    })),
    images: (row.product_images ?? [])
      .sort((a, b) => a.position - b.position)
      .map((image) => ({
        id: image.id, imageUrl: image.image_url, position: image.position, altText: image.alt_text,
        storageBucket: image.storage_bucket ?? null, storagePath: image.storage_path ?? null,
        mimeType: image.mime_type ?? null, width: image.width ?? null, height: image.height ?? null,
        fileSize: image.file_size ?? null, status: image.status ?? "ready",
      })),
  };
}

export function toRpcPayload(input: ProductInput, id?: string) {
  return {
    p_product: {
      ...(id ? { id } : {}),
      sku: input.sku.trim().toUpperCase(), name: input.name.trim(), description: input.description.trim(),
      category: input.category.trim(), subcategory: input.subcategory.trim(), price: input.price,
      style: input.style.trim(), season: input.season.trim(), formality: input.formality.trim(),
      fit: input.fit.trim(), material: input.material.trim(), occasions: input.occasions, active: input.active,
      brand_id: input.brandId || null, category_id: input.categoryId, slug: input.slug.trim(),
      short_description: input.shortDescription.trim(), publication_status: input.publicationStatus,
      seo_title: input.seoTitle.trim(), seo_description: input.seoDescription.trim(),
    },
    p_variants: input.variants.map((variant) => ({
      id: variant.id, variant_sku: variant.variantSku.trim().toUpperCase(), color: variant.color.trim(),
      size: variant.size.trim(), stock: Number(variant.stock), active: variant.active,
    })),
    p_images: input.images.filter((image) => !image.storagePath).map((image) => ({
      id: image.id, image_url: image.imageUrl.trim(), position: image.position, alt_text: image.altText.trim(),
    })),
  };
}

export function mapBrand(row: Record<string, unknown>): CatalogBrand {
  return { id: String(row.id), code: String(row.code), name: String(row.name), slug: String(row.slug), active: Boolean(row.active) };
}

export function mapCategory(row: Record<string, unknown>): CatalogCategory {
  return {
    id: String(row.id), brandId: String(row.brand_id), parentId: row.parent_id ? String(row.parent_id) : null,
    code: String(row.code), name: String(row.name), slug: String(row.slug), description: String(row.description ?? ""),
    position: Number(row.position), active: Boolean(row.active),
  };
}
