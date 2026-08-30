import Link from "next/link";
import type { MockProduct } from "@/lib/storefront/mock-types";
import { productPath } from "@/lib/storefront/urls";
import { ProductVisual } from "./product-visual";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

export function ProductCard({ product }: { product: MockProduct }) {
  return <article className="store-product-card">
    <Link href={productPath(product.slug)} className="store-product-image">
      <ProductVisual tone={product.visual} label={product.name}/>
      {product.discountPercentage && <span className="store-sale-badge">-{product.discountPercentage}%</span>}
      {product.newArrival && !product.discountPercentage && <span className="store-new-badge">Nuevo</span>}
    </Link>
    <div className="store-product-copy"><p>{product.category}</p><Link href={productPath(product.slug)}>{product.name}</Link><div className="store-price">{product.promotionalPrice ? <><strong>{money.format(product.promotionalPrice)}</strong><s>{money.format(product.price)}</s></> : <strong>{money.format(product.price)}</strong>}</div></div>
  </article>;
}
