import { Product, ProductInput } from "./types";

type DbImage = { id: string; image_url: string; position: number; alt_text: string };
type DbVariant = { id: string; variant_sku: string; color: string; size: string; stock: number; active: boolean };
type DbProduct = {
  id: string; sku: string; name: string; description: string; category: string;
  subcategory: string; price: number | string; style: string; season: string;
  formality: string; fit: string; material: string; occasions: string[];
  active: boolean; created_at: string; updated_at: string;
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
      .map((image) => ({ id: image.id, imageUrl: image.image_url, position: image.position, altText: image.alt_text })),
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
    },
    p_variants: input.variants.map((variant) => ({
      id: variant.id, variant_sku: variant.variantSku.trim().toUpperCase(), color: variant.color.trim(),
      size: variant.size.trim(), stock: Number(variant.stock), active: variant.active,
    })),
    p_images: input.images.map((image) => ({
      id: image.id, image_url: image.imageUrl.trim(), position: image.position, alt_text: image.altText.trim(),
    })),
  };
}

