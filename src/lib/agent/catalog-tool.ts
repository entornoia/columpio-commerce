import type { SupabaseClient } from "@supabase/supabase-js";
import { searchCatalog, type CatalogSearchFilters } from "@/lib/catalog-search";

export const catalogToolDefinition = {
  type: "function" as const,
  name: "search_catalog",
  description: "Busca productos y variantes reales de Columpio Mujer usando filtros estructurados. Debe llamarse antes de afirmar precio, stock, talla, color o disponibilidad.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: ["string", "null"], description: "Solo nombre, SKU o texto real de nombre/descripción. Debe ser null si la petición solo contiene tipo de prenda, color, talla, ocasión o precio." },
      category: { type: ["string", "null"], description: "Categoría exacta conocida, por ejemplo Chaquetas, Pantalones o Tops." },
      subcategory: { type: ["string", "null"], description: "Subcategoría exacta conocida, por ejemplo Blazers o Blusas." },
      color: { type: ["string", "null"], description: "Color separado del query." },
      size: { type: ["string", "null"], description: "Talla separada del query." }, style: { type: ["string", "null"] },
      season: { type: ["string", "null"] }, formality: { type: ["string", "null"] },
      fit: { type: ["string", "null"] }, material: { type: ["string", "null"] },
      occasion: { type: ["string", "null"] }, active: { type: ["boolean", "null"] },
      inStock: { type: ["boolean", "null"] }, minPrice: { type: ["number", "null"] },
      maxPrice: { type: ["number", "null"] },
    },
    required: ["query", "category", "subcategory", "color", "size", "style", "season", "formality", "fit", "material", "occasion", "active", "inStock", "minPrice", "maxPrice"],
  },
};

const stringKeys = ["query", "category", "subcategory", "color", "size", "style", "season", "formality", "fit", "material", "occasion"] as const;

export function validateCatalogToolInput(input: unknown): CatalogSearchFilters {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Filtros de catálogo inválidos.");
  const value = input as Record<string, unknown>;
  const filters: CatalogSearchFilters = { active: true };
  for (const key of stringKeys) {
    if (value[key] !== null && value[key] !== undefined) {
      if (typeof value[key] !== "string" || String(value[key]).length > 120) throw new Error(`Filtro ${key} inválido.`);
      const clean = String(value[key]).trim();
      if (clean) filters[key] = clean;
    }
  }
  if (value.inStock !== null && value.inStock !== undefined) {
    if (typeof value.inStock !== "boolean") throw new Error("Filtro inStock inválido.");
    filters.inStock = value.inStock;
  }
  for (const key of ["minPrice", "maxPrice"] as const) {
    if (value[key] !== null && value[key] !== undefined) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 100_000_000) throw new Error(`Filtro ${key} inválido.`);
      filters[key] = value[key];
    }
  }
  return filters;
}

export async function executeCatalogTool(supabase: SupabaseClient, input: unknown) {
  const filters = validateCatalogToolInput(input);
  const results = await searchCatalog(supabase, filters);
  return { filters, results, resultCount: results.length };
}
