export function ProductArt({ index = 0, imageUrl, alt = "Producto sin imagen cargada" }: { index?: number; imageUrl?: string; alt?: string }) {
  const classes = ["art-blazer", "art-pants", "art-blouse"];
  return <div className={`product-art ${classes[index % classes.length]} ${imageUrl ? "has-image" : ""}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined} role="img" aria-label={imageUrl ? alt : "Producto sin imagen cargada"}><span/><small>CM</small></div>;
}
