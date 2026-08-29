import type { SupabaseClient } from "@supabase/supabase-js";
import { searchCatalog, type CatalogSearchFilters, type CatalogSearchResult } from "../../catalog-search.ts";

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-CL").trim();

const categoryAliases: Array<{ aliases: string[]; filters: Pick<CatalogSearchFilters, "category" | "subcategory">; searchTerm: string }> = [
  { aliases: ["blusa", "blusas", "blouse", "blouses"], filters: { subcategory: "Blusas" }, searchTerm: "blusa" },
  { aliases: ["blazer", "blazers"], filters: { category: "Chaquetas", subcategory: "Blazers" }, searchTerm: "blazer" },
  { aliases: ["pantalon", "pantalones", "pants", "trousers"], filters: { category: "Pantalones" }, searchTerm: "pantalón" },
  { aliases: ["chaqueta", "chaquetas", "jacket", "jackets"], filters: { category: "Chaquetas" }, searchTerm: "chaqueta" },
  { aliases: ["vestido", "vestidos", "dress", "dresses"], filters: { category: "Vestidos" }, searchTerm: "vestido" },
];

const colorAliases = new Map<string, string>([
  ["negro", "Negro"], ["negra", "Negro"], ["black", "Negro"],
  ["marfil", "Marfil"], ["ivory", "Marfil"],
  ["blanco", "Blanco"], ["blanca", "Blanco"], ["white", "Blanco"],
  ["camel", "Camel"],
]);

function categoryAlias(...values: Array<string | null | undefined>) {
  const words = values.filter(Boolean).flatMap((value) => normalize(value!).split(/\s+/));
  return categoryAliases.find((entry) => entry.aliases.some((alias) => words.includes(alias))) ?? null;
}

function cleanProductQuery(value: string | null, alias: ReturnType<typeof categoryAlias>, color: string | null) {
  if (!value?.trim()) return null;
  const ignored = new Set([...(alias?.aliases ?? []), ...(color ? [normalize(color), "color"] : [])]);
  const remaining = normalize(value).split(/\s+/).filter((word) => !ignored.has(word) && !["una", "un", "de", "en", "ig"].includes(word));
  return remaining.length ? remaining.join(" ") : null;
}

export type NormalizedSemanticCatalogSearch = {
  canonicalCategory: string | null;
  canonicalColor: string | null;
  primaryFilters: CatalogSearchFilters;
  fallbackFilters: CatalogSearchFilters | null;
};

export function normalizeSemanticCatalogSearch(input: { productName: string | null; referenceCategory: string | null; targetCategory: string | null; referenceColor: string | null; targetColor: string | null; size?: string | null }): NormalizedSemanticCatalogSearch {
  const alias = categoryAlias(input.targetCategory, input.referenceCategory, input.productName);
  const rawColor = input.targetColor ?? input.referenceColor;
  const canonicalColor = rawColor ? colorAliases.get(normalize(rawColor)) ?? rawColor.trim() : null;
  const query = cleanProductQuery(input.productName, alias, canonicalColor);
  const common: CatalogSearchFilters = { active: true, inStock: true };
  if (canonicalColor) common.color = canonicalColor;
  if (input.size?.trim()) common.size = input.size.trim();
  const primaryFilters: CatalogSearchFilters = { ...common, ...(alias?.filters ?? {}), ...(query ? { query } : {}) };
  const fallbackFilters = alias ? { ...common, query: query ?? alias.searchTerm } : null;
  return {
    canonicalCategory: alias ? alias.filters.subcategory ?? alias.filters.category ?? null : input.targetCategory ?? input.referenceCategory,
    canonicalColor,
    primaryFilters,
    fallbackFilters: fallbackFilters && JSON.stringify(fallbackFilters) !== JSON.stringify(primaryFilters) ? fallbackFilters : null,
  };
}

export async function searchSemanticCatalog(supabase: SupabaseClient, normalized: NormalizedSemanticCatalogSearch): Promise<{ results: CatalogSearchResult[]; filters: CatalogSearchFilters; attempts: Array<{ filters: CatalogSearchFilters; resultCount: number }> }> {
  const attempts: Array<{ filters: CatalogSearchFilters; resultCount: number }> = [];
  const primary = await searchCatalog(supabase, normalized.primaryFilters);
  attempts.push({ filters: normalized.primaryFilters, resultCount: primary.length });
  if (primary.length || !normalized.fallbackFilters) return { results: primary, filters: normalized.primaryFilters, attempts };
  const fallback = await searchCatalog(supabase, normalized.fallbackFilters);
  attempts.push({ filters: normalized.fallbackFilters, resultCount: fallback.length });
  return { results: fallback, filters: normalized.fallbackFilters, attempts };
}
