import Link from "next/link";

type LegalSection = { title: string; paragraphs: React.ReactNode[] };

export function LegalPage({ eyebrow, title, intro, sections }: { eyebrow: string; title: string; intro: string; sections: LegalSection[] }) {
  return <div className="legal-page">
    <header className="legal-header">
      <Link href="/privacy" className="legal-brand" aria-label="Columpio Commerce"><span className="brand-mark">C</span><span><strong>Columpio</strong><small>COMMERCE</small></span></Link>
      <nav aria-label="Documentos legales"><Link href="/privacy">Privacidad</Link><Link href="/terms">Condiciones</Link><Link href="/data-deletion">Eliminar datos</Link></nav>
    </header>
    <main className="legal-content">
      <span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="legal-intro">{intro}</p><p className="legal-updated">Última actualización: 26 de agosto de 2026</p>
      {sections.map((section) => <section key={section.title}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}
    </main>
    <footer className="legal-footer">Columpio Commerce · Columpio Mujer</footer>
  </div>;
}
