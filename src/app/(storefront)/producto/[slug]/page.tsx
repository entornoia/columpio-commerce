import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/storefront/product-card";
import { ProductVisual } from "@/components/storefront/product-visual";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { getPublicProductBySlug, listPublicProducts } from "@/lib/storefront/catalog";
import { collectionPath } from "@/lib/storefront/urls";

const money = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const product = await getPublicProductBySlug((await params).slug);
    if (!product) return { title: "Producto" };
    return { title: product.seoTitle || product.name, description: product.seoDescription || product.shortDescription || product.description, alternates: { canonical: `https://columpiostore.cl/producto/${encodeURIComponent(product.slug)}` } };
  } catch { return { title: "Producto" }; }
}

export default async function ProductPage({ params }: Props) {
  let product;
  try { product = await getPublicProductBySlug((await params).slug); }
  catch (error) {
    console.error(error);
    return <div className="store-empty"><h1>Catálogo temporalmente no disponible</h1><p>No pudimos consultar este producto. Intenta nuevamente más tarde.</p></div>;
  }
  if (!product) notFound();
  const related = (await listPublicProducts(product.categorySlug, 5)).filter((item) => item.slug !== product.slug).slice(0, 4);
  const colors = [...new Set(product.variants.map((variant) => variant.color))];
  const sizes = [...new Set(product.variants.map((variant) => variant.size))];
  const details = [product.material && `Material: ${product.material}`, product.style && `Estilo: ${product.style}`].filter(Boolean) as string[];

  return <div className="store-product-page"><nav className="store-breadcrumb"><Link href="/">Inicio</Link><span>/</span><Link href={collectionPath(product.categorySlug)}>{product.categoryName}</Link><span>/</span><span>{product.name}</span></nav><section className="store-product-detail"><div className="store-gallery">{product.images.length ? product.images.map((image) => <ProductVisual key={`${image.position}-${image.url}`} imageUrl={image.url} label={image.alt || product.name}/>) : <ProductVisual label={product.name}/>}</div><div className="store-product-info"><p className="store-kicker">{product.categoryName.toUpperCase()}</p><h1>{product.name}</h1><div className="store-detail-price"><strong>{money.format(product.price)}</strong></div><p className="store-description">{product.shortDescription || product.description}</p><div className="store-option"><div><b>Color</b><span>{colors[0] ?? "Por definir"}</span></div><div className="store-color-list">{colors.map((color, index) => <button key={color} className={index === 0 ? "selected" : ""} aria-label={`Color ${color}`} title={color}><i className={`store-swatch store-swatch-${index % 4}`}/></button>)}</div></div><div className="store-option"><div><b>Talla</b><button className="store-size-guide">Guía de tallas</button></div><div className="store-size-list">{sizes.map((size, index) => <button key={size} className={index === 0 ? "selected" : ""}>{size}</button>)}</div></div><p className={`store-availability ${product.isAvailable ? "" : "muted"}`}><i/>{product.isAvailable ? "Disponible" : "Sin disponibilidad"}</p><button className="store-add-button" type="button">Agregar al carrito <StoreIcon name="bag"/></button><small className="store-demo-note">Vista presentacional · el carrito estará disponible próximamente.</small><div className="store-accordions"><details open><summary>Descripción <StoreIcon name="chevron"/></summary><p>{product.description}</p></details><details><summary>Detalles <StoreIcon name="chevron"/></summary>{details.length ? <ul>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : <p>Información detallada próximamente.</p>}</details><details><summary>Despacho y retiro <StoreIcon name="chevron"/></summary><p>Despachos a todo Chile y retiro disponible. Valores definitivos en el futuro checkout.</p></details></div></div></section>{related.length > 0 && <section className="store-related"><div className="store-section-head"><div><p className="store-kicker">COMBÍNALO CON</p><h2>También te puede gustar</h2></div></div><div className="store-product-grid">{related.map((item) => <ProductCard key={item.slug} product={item}/>)}</div></section>}</div>;
}
