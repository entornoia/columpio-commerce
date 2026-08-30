import type { Metadata } from "next";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { StorefrontHeader } from "@/components/storefront/storefront-header";
import { listPublicCategories } from "@/lib/storefront/catalog";
import type { PublicCatalogCategory } from "@/lib/storefront/catalog-types";
import "./storefront.css";

export const metadata: Metadata = { title: { absolute: "Columpio Store" }, description: "Una selección de moda femenina contemporánea de Columpio Mujer." };
export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  let categories: PublicCatalogCategory[] = [];
  try { categories = await listPublicCategories(); }
  catch (error) { console.error(error); }
  return <div className="store-root"><StorefrontHeader categories={categories}/><main>{children}</main><StorefrontFooter/></div>;
}
