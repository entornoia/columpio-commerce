import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/storefront/product-card";
import { ProductVisual } from "@/components/storefront/product-visual";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { getMockProduct, mockProducts } from "@/lib/storefront/mock-data";
import { collectionPath } from "@/lib/storefront/urls";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return mockProducts.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> { const item = getMockProduct((await params).slug); return { title: item?.name ?? "Producto", description: item?.description }; }

export default async function ProductPage({ params }: Props) {
  const product = getMockProduct((await params).slug);
  if (!product) notFound();
  const related = mockProducts
    .filter((item) => item.slug !== product.slug)
    .sort((a, b) => Number(b.categorySlug === product.categorySlug) - Number(a.categorySlug === product.categorySlug))
    .slice(0, 4);
  return <div className="store-product-page"><nav className="store-breadcrumb"><Link href="/">Inicio</Link><span>/</span><Link href={collectionPath(product.categorySlug)}>{product.category}</Link><span>/</span><span>{product.name}</span></nav><section className="store-product-detail"><div className="store-gallery">{product.images.map((tone, index) => <ProductVisual key={`${tone}-${index}`} tone={tone} label={`${product.name}, vista ${index + 1}`}/>)}</div><div className="store-product-info"><p className="store-kicker">{product.category.toUpperCase()}</p><h1>{product.name}</h1><div className="store-detail-price">{product.promotionalPrice ? <><strong>{money.format(product.promotionalPrice)}</strong><s>{money.format(product.price)}</s><span>-{product.discountPercentage}%</span></> : <strong>{money.format(product.price)}</strong>}</div><p className="store-description">{product.description}</p><div className="store-option"><div><b>Color</b><span>{product.colors[0]}</span></div><div className="store-color-list">{product.colors.map((color, index) => <button key={color} className={index === 0 ? "selected" : ""} aria-label={`Color ${color}`} title={color}><i className={`store-swatch store-swatch-${index}`}/></button>)}</div></div><div className="store-option"><div><b>Talla</b><button className="store-size-guide">Guía de tallas</button></div><div className="store-size-list">{product.sizes.map((size, index) => <button key={size} className={index === 0 ? "selected" : ""}>{size}</button>)}</div></div><p className={`store-availability ${product.availability === "Próximamente" ? "muted" : ""}`}><i/>{product.availability}</p><button className="store-add-button" type="button">Agregar al carrito <StoreIcon name="bag"/></button><small className="store-demo-note">Vista presentacional · el carrito estará disponible próximamente.</small><div className="store-accordions"><details open><summary>Descripción <StoreIcon name="chevron"/></summary><p>{product.description}</p></details><details><summary>Detalles <StoreIcon name="chevron"/></summary><ul>{product.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></details><details><summary>Despacho y retiro <StoreIcon name="chevron"/></summary><p>Despachos a todo Chile y retiro disponible. Valores definitivos en el futuro checkout.</p></details></div></div></section><section className="store-related"><div className="store-section-head"><div><p className="store-kicker">COMBÍNALO CON</p><h2>También te puede gustar</h2></div></div><div className="store-product-grid">{related.map((item) => <ProductCard key={item.slug} product={item}/>)}</div></section></div>;
}
