export function ProductVisual({ tone = "sand", label, className = "", imageUrl }: { tone?: string; label: string; className?: string; imageUrl?: string }) {
  return <div className={`store-visual store-tone-${tone} ${className}`} role="img" aria-label={imageUrl ? label : `Placeholder temporal para fotografía de ${label}`} style={imageUrl ? { backgroundImage: `url("${imageUrl.replaceAll('"', "%22")}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
    {!imageUrl && <><span className="store-visual-shape"/><small>FOTOGRAFÍA PRÓXIMAMENTE</small></>}
  </div>;
}
