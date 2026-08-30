export function ProductVisual({ tone, label, className = "" }: { tone: string; label: string; className?: string }) {
  return <div className={`store-visual store-tone-${tone} ${className}`} role="img" aria-label={`Placeholder temporal para fotografía de ${label}`}>
    <span className="store-visual-shape"/><small>FOTOGRAFÍA PRÓXIMAMENTE</small>
  </div>;
}
