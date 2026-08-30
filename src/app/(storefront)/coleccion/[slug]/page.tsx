import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/storefront/product-card";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { getMockCollection, mockCollections, productsForCollection } from "@/lib/storefront/mock-data";

type Props = { params: Promise<{ slug: string }> };
export function generateStaticParams() { return mockCollections.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> { const item = getMockCollection((await params).slug); return { title: item?.name ?? "Colección" }; }

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const collection = getMockCollection(slug);
  if (!collection) notFound();
  const products = productsForCollection(slug);
  return <div className="store-collection-page"><header className={`store-collection-hero store-tone-${collection.visual}`}><p className="store-kicker">COLUMPIO MUJER</p><h1>{collection.name}</h1><p>{collection.description}</p></header><div className="store-collection-toolbar"><span>{products.length} productos</span><div><button><StoreIcon name="filter"/> Filtrar</button><button>Ordenar <StoreIcon name="chevron"/></button></div></div>{products.length ? <div className="store-product-grid store-collection-grid">{products.map((product) => <ProductCard key={product.slug} product={product}/>)}</div> : <div className="store-empty"><h2>Muy pronto</h2><p>Estamos preparando una selección especial para esta colección.</p></div>}</div>;
}
