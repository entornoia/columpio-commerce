import Link from "next/link";
import { StoreBenefits } from "@/components/storefront/benefits";
import { ProductCard } from "@/components/storefront/product-card";
import { ProductVisual } from "@/components/storefront/product-visual";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront/catalog";
import { collectionPath } from "@/lib/storefront/urls";

const categoryTones = ["clay", "ivory", "rose", "taupe", "hazel", "cocoa"];

export default async function StorefrontHome() {
  let catalog;
  try {
    const [categories, products] = await Promise.all([listPublicCategories(), listPublicProducts(undefined, 8)]);
    catalog = { categories, products };
  } catch (error) {
    console.error(error);
    catalog = null;
  }
  const newArrivals = catalog?.products.slice(0, 4) ?? [];
  const favorites = catalog?.products.slice(4, 8) ?? [];

  return <>
    <section className="store-hero"><ProductVisual tone="hero" label="fotografía principal futura de una modelo con prendas Columpio Mujer" className="store-hero-visual"/><div className="store-hero-copy"><p className="store-kicker">NUEVA COLECCIÓN · MUJER</p><h1>Prendas que se sienten como tú.</h1><p>Una selección cálida y contemporánea para acompañarte todos los días.</p><Link className="store-primary-cta" href="/coleccion/vestidos">Ver novedades <StoreIcon name="arrow"/></Link></div></section>

    <section className="store-section store-categories"><div className="store-section-head"><div><p className="store-kicker">EXPLORA A TU MANERA</p><h2>Categorías destacadas</h2></div></div>{catalog ? <div className="store-category-grid">{catalog.categories.map((category, index) => <Link key={category.slug} href={collectionPath(category.slug)}><ProductVisual tone={categoryTones[index % categoryTones.length]} label={category.name}/><span>{category.name} <StoreIcon name="arrow"/></span></Link>)}</div> : <CatalogUnavailable/>}</section>

    <section className="store-section"><div className="store-section-head"><div><p className="store-kicker">LO NUEVO</p><h2>Recién llegados</h2></div><Link href="/coleccion/vestidos">Ver todo <StoreIcon name="arrow"/></Link></div>{newArrivals.length ? <div className="store-product-grid">{newArrivals.map((product) => <ProductCard key={product.slug} product={product}/>)}</div> : catalog && <EmptyCatalog/>}</section>

    <section className="store-promo"><div><p className="store-kicker">UN MOMENTO PARA TI</p><h2>Descubre la nueva colección</h2><p>Piezas especiales para renovar tus favoritos de temporada.</p><Link href="/coleccion/vestidos">Descubrir selección</Link></div><ProductVisual tone="promo" label="selección editorial"/></section>

    <section className="store-section"><div className="store-section-head"><div><p className="store-kicker">NUESTRA SELECCIÓN</p><h2>Favoritos de Columpio</h2></div><Link href="/coleccion/blusas">Ver favoritos <StoreIcon name="arrow"/></Link></div>{favorites.length ? <div className="store-product-grid">{favorites.map((product) => <ProductCard key={product.slug} product={product}/>)}</div> : catalog && <EmptyCatalog/>}</section>
    <StoreBenefits/>
  </>;
}

function EmptyCatalog() { return <div className="store-empty"><h2>Muy pronto</h2><p>Estamos preparando productos para publicar en la tienda.</p></div>; }
function CatalogUnavailable() { return <div className="store-empty"><h2>Catálogo temporalmente no disponible</h2><p>No pudimos consultar el catálogo. Intenta nuevamente más tarde.</p></div>; }
