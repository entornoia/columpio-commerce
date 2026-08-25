export type Variant = {
  id: string;
  variantSku: string;
  color: string;
  size: string;
  stock: number;
  active: boolean;
};

export type ProductImage = { id: string; imageUrl: string; position: number; altText: string };

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
  createdAt: string;
  updatedAt: string;
  variants: Variant[];
  images: ProductImage[];
};

export type ProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

