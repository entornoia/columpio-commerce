export type MockAvailability = "Disponible" | "Pocas unidades" | "Próximamente";

export type MockProduct = {
  slug: string; name: string; category: string; categorySlug: string; description: string;
  details: string[]; price: number; promotionalPrice?: number; discountPercentage?: number;
  colors: string[]; sizes: string[]; availability: MockAvailability; featured: boolean;
  newArrival: boolean; visual: string; images: string[];
};

export type MockCollection = { slug: string; name: string; description: string; visual: string };
