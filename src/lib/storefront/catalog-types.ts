export type PublicCatalogImage = { url: string; alt: string; position: number };
export type PublicCatalogVariant = { color: string; size: string; available: boolean };

export type PublicCatalogProduct = {
  id: string;
  brandSlug: string;
  brandName?: string;
  categorySlug: string;
  categoryName: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  price: number;
  style: string;
  material: string;
  isAvailable: boolean;
  colors: string[];
  sizes: string[];
  variants: PublicCatalogVariant[];
  images: PublicCatalogImage[];
  seoTitle?: string;
  seoDescription?: string;
  publishedAt: string;
};

export type PublicCatalogCategory = {
  id: string;
  slug: string;
  name: string;
  description: string;
  sortPosition: number;
  productCount: number;
};
