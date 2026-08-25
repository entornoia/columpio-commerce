export function ProductArt({ index = 0 }: { index?: number }) {
  const classes = ["art-blazer", "art-pants", "art-blouse"];
  return <div className={`product-art ${classes[index % classes.length]}`} aria-label="Producto sin imagen cargada"><span/><small>CM</small></div>;
}

