import type { Metadata } from "next";
import { CartPage } from "@/components/storefront/cart-page";

export const metadata: Metadata = { title: "Carrito | Columpio Store", robots: { index: false, follow: false } };
export default function Page() { return <CartPage/>; }
