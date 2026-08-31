import type { Metadata } from "next";
import Link from "next/link";
import { PaymentResult } from "@/components/storefront/payment-result";

export const metadata: Metadata = { title: "Resultado del pago | Columpio Commerce" };

export default function PaymentResultPage() {
  return <main className="legal-page">
    <header className="legal-header">
      <Link href="/privacy" className="legal-brand" aria-label="Columpio Commerce"><span className="brand-mark">C</span><span><strong>Columpio</strong><small>COMMERCE</small></span></Link>
    </header>
    <PaymentResult />
  </main>;
}
