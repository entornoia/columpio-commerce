import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Resultado del pago | Columpio Commerce" };

export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<{ provider?: string | string[] }> }) {
  const provider = (await searchParams).provider;
  const label = provider === "flow" ? "Retorno de Flow recibido" : "Resultado de pago";
  return <main className="legal-page">
    <header className="legal-header">
      <Link href="/privacy" className="legal-brand" aria-label="Columpio Commerce"><span className="brand-mark">C</span><span><strong>Columpio</strong><small>COMMERCE</small></span></Link>
    </header>
    <article className="legal-content">
      <p className="eyebrow">PAGO EN FLOW</p>
      <h1>{label}</h1>
      <p>Este resultado es informativo. La confirmación definitiva del pago será validada directamente con Flow antes de actualizar el pedido.</p>
      <p>Puedes volver a Instagram para continuar la conversación con Columpio Mujer.</p>
    </article>
  </main>;
}
