export type Variant = {
  id: string;
  variantSku: string;
  color: string;
  size: string;
  stock: number;
  active: boolean;
};

export type ProductImageStatus = "pending" | "ready" | "delete_pending" | "failed";
export type ProductImage = {
  id: string;
  imageUrl: string;
  position: number;
  altText: string;
  storageBucket: string | null;
  storagePath: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  status: ProductImageStatus;
};

export type PublicationStatus = "draft" | "ready" | "published" | "archived";
export type CatalogBrand = { id: string; code: string; name: string; slug: string; active: boolean };
export type CatalogCategory = {
  id: string; brandId: string; parentId: string | null; code: string; name: string;
  slug: string; description: string; position: number; active: boolean;
};

export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  price: number;
  style: string;
  season: string;
  formality: string;
  fit: string;
  material: string;
  occasions: string[];
  active: boolean;
  brandId: string;
  categoryId: string | null;
  slug: string;
  shortDescription: string;
  publicationStatus: PublicationStatus;
  publishedAt: string | null;
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
  updatedAt: string;
  variants: Variant[];
  images: ProductImage[];
};

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;
