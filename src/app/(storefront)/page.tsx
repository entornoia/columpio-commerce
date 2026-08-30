import Link from "next/link";
import { StoreBenefits } from "@/components/storefront/benefits";
import { ProductCard } from "@/components/storefront/product-card";
import { ProductVisual } from "@/components/storefront/product-visual";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { mockCollections, mockProducts } from "@/lib/storefront/mock-data";
import { collectionPath } from "@/lib/storefront/urls";

export default function StorefrontHome() {
  const newArrivals = mockProducts.filter((product) => product.newArrival).slice(0, 4);
  const favorites = mockProducts.filter((product) => product.featured).slice(0, 4);
  return <>
    <section className="store-hero"><ProductVisual tone="hero" label="fotografía principal futura de una modelo con prendas Columpio Mujer" className="store-hero-visual"/><div className="store-hero-copy"><p className="store-kicker">NUEVA COLECCIÓN · MUJER</p><h1>Prendas que se sienten como tú.</h1><p>Una selección cálida y contemporánea para acompañarte todos los días.</p><Link className="store-primary-cta" href="/coleccion/vestidos">Ver novedades <StoreIcon name="arrow"/></Link></div></section>

    <section className="store-section store-categories"><div className="store-section-head"><div><p className="store-kicker">EXPLORA A TU MANERA</p><h2>Categorías destacadas</h2></div></div><div className="store-category-grid">{mockCollections.map((collection) => <Link key={collection.slug} href={collectionPath(collection.slug)}><ProductVisual tone={collection.visual} label={collection.name}/><span>{collection.name} <StoreIcon name="arrow"/></span></Link>)}</div></section>

    <section className="store-section"><div className="store-section-head"><div><p className="store-kicker">LO NUEVO</p><h2>Recién llegados</h2></div><Link href="/coleccion/vestidos">Ver todo <StoreIcon name="arrow"/></Link></div><div className="store-product-grid">{newArrivals.map((product) => <ProductCard key={product.slug} product={product}/>)}</div></section>

    <section className="store-promo"><div><p className="store-kicker">UN MOMENTO PARA TI</p><h2>Hasta 20% en seleccionados</h2><p>Descubre piezas especiales para renovar tus favoritos de temporada.</p><Link href="/coleccion/vestidos">Descubrir selección</Link></div><ProductVisual tone="promo" label="selección promocional"/></section>

    <section className="store-section"><div className="store-section-head"><div><p className="store-kicker">NUESTRA SELECCIÓN</p><h2>Favoritos de Columpio</h2></div><Link href="/coleccion/blusas">Ver favoritos <StoreIcon name="arrow"/></Link></div><div className="store-product-grid">{favorites.map((product) => <ProductCard key={product.slug} product={product}/>)}</div></section>
    <StoreBenefits/>
  </>;
}
