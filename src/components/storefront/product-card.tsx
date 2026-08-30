import Link from "next/link";
import type { PublicCatalogProduct } from "@/lib/storefront/catalog-types";
import { productPath } from "@/lib/storefront/urls";
import { ProductVisual } from "./product-visual";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function ProductCard({ product }: { product: PublicCatalogProduct }) {
  const primaryImage = product.images.find((image) => image.position === 0);
  return <article className="store-product-card">
    <Link href={productPath(product.slug)} className="store-product-image">
      <ProductVisual label={primaryImage?.alt || product.name} imageUrl={primaryImage?.url}/>
    </Link>
    <div className="store-product-copy"><p>{product.categoryName}</p><Link href={productPath(product.slug)}>{product.name}</Link><div className="store-price"><strong>{money.format(product.price)}</strong></div></div>
  </article>;
}
