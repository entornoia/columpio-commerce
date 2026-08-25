import { Product } from "./types";

const now = "2026-08-24T12:00:00.000Z";
const variant = (id: string, variantSku: string, color: string, size: string, stock: number) => ({ id, variantSku, color, size, stock, active: true });

export const seedProducts: Product[] = [
  {
    id: "product-1", sku: "CM-001", name: "Blazer Emilia", description: "Blazer estructurado de líneas limpias, ideal para elevar looks cotidianos.", category: "Chaquetas", subcategory: "Blazers", price: 54990, style: "Clásico", season: "Todo el año", formality: "Semi formal", fit: "Regular", material: "Poliéster y viscosa", occasions: ["Oficina", "Cena"], active: true, createdAt: now, updatedAt: now, images: [],
    variants: [variant("v1", "CM-001-NEG-S", "Negro", "S", 2), variant("v2", "CM-001-NEG-M", "Negro", "M", 1), variant("v3", "CM-001-NEG-L", "Negro", "L", 0), variant("v4", "CM-001-CAM-S", "Camel", "S", 1), variant("v5", "CM-001-CAM-M", "Camel", "M", 3)],
  },
  {
    id: "product-2", sku: "CM-002", name: "Pantalón Renata", description: "Pantalón sastrero de tiro alto y caída recta.", category: "Pantalones", subcategory: "Sastreros", price: 42990, style: "Minimalista", season: "Todo el año", formality: "Semi formal", fit: "Recto", material: "Viscosa", occasions: ["Oficina", "Evento"], active: true, createdAt: now, updatedAt: now, images: [],
    variants: [variant("v6", "CM-002-NEG-S", "Negro", "S", 4), variant("v7", "CM-002-NEG-M", "Negro", "M", 2)],
  },
  {
    id: "product-3", sku: "CM-003", name: "Blusa Amelia", description: "Blusa fluida de cuello redondo y manga suave.", category: "Tops", subcategory: "Blusas", price: 32990, style: "Romántico", season: "Primavera verano", formality: "Casual elegante", fit: "Holgado", material: "Rayón", occasions: ["Oficina", "Fin de semana"], active: false, createdAt: now, updatedAt: now, images: [],
    variants: [variant("v8", "CM-003-MAR-S", "Marfil", "S", 3), variant("v9", "CM-003-MAR-M", "Marfil", "M", 2)],
  },
];

