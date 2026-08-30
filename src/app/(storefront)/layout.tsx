import type { Metadata } from "next";
import { StorefrontFooter } from "@/components/storefront/storefront-footer";
import { StorefrontHeader } from "@/components/storefront/storefront-header";
import "./storefront.css";

export const metadata: Metadata = { title: { absolute: "Columpio Store" }, description: "Una selección de moda femenina contemporánea de Columpio Mujer." };

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return <div className="store-root"><StorefrontHeader/><main>{children}</main><StorefrontFooter/></div>;
}
