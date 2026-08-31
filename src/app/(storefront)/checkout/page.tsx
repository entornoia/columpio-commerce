import type { Metadata } from "next";
import { CheckoutPage } from "@/components/storefront/checkout-page";

export const metadata: Metadata = { title: "Checkout | Columpio Store", robots: { index: false, follow: false } };
export default function Page() { return <CheckoutPage/>; }
