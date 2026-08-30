import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/storefront/product-card";
import { StoreIcon } from "@/components/storefront/storefront-icons";
import { listPublicCategories, listPublicProducts } from "@/lib/storefront/catalog";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const category = (await listPublicCategories()).find((item) => item.slug === slug);
    return { title: category?.name ?? "Colección", description: category?.description || undefined, alternates: { canonical: `https://columpiostore.cl/coleccion/${encodeURIComponent(slug)}` } };
  } catch { return { title: "Colección" }; }
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  let category;
  let products;
  try {
    [category, products] = await Promise.all([
      listPublicCategories().then((categories) => categories.find((item) => item.slug === slug)),
      listPublicProducts(slug),
    ]);
  } catch (error) {
    console.error(error);
    return <div className="store-empty"><h1>Catálogo temporalmente no disponible</h1><p>No pudimos consultar esta colección. Intenta nuevamente más tarde.</p></div>;
  }
  if (!category) notFound();
  return <div className="store-collection-page"><header className="store-collection-hero store-tone-clay"><p className="store-kicker">COLUMPIO MUJER</p><h1>{category.name}</h1>{category.description && <p>{category.description}</p>}</header><div className="store-collection-toolbar"><span>{products.length} productos</span><div><button><StoreIcon name="filter"/> Filtrar</button><button>Ordenar <StoreIcon name="chevron"/></button></div></div>{products.length ? <div className="store-product-grid store-collection-grid">{products.map((product) => <ProductCard key={product.slug} product={product}/>)}</div> : <div className="store-empty"><h2>Muy pronto</h2><p>Estamos preparando productos para publicar en esta colección.</p></div>}</div>;
}
