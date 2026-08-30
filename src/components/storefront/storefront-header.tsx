"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { PublicCatalogCategory } from "@/lib/storefront/catalog-types";
import { collectionPath } from "@/lib/storefront/urls";
import { StoreIcon } from "./storefront-icons";

export function StorefrontHeader({ categories }: { categories: PublicCatalogCategory[] }) {
  const pathname = usePathname();
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const closeMobileMenu = () => { if (mobileMenu.current) mobileMenu.current.open = false; };

  useEffect(() => { if (mobileMenu.current) mobileMenu.current.open = false; }, [pathname]);

  return <>
    <div className="store-announcement">Despachos a todo Chile · Retiro disponible</div>
    <header className="store-header">
      <div className="store-header-row">
        <details ref={mobileMenu} className="store-mobile-drawer store-mobile-only">
          <summary className="store-icon-button" aria-label="Abrir menú de categorías"><StoreIcon name="menu"/></summary>
          <nav aria-label="Categorías">{categories.map((item) => <Link key={item.slug} href={collectionPath(item.slug)} onClick={closeMobileMenu}>{item.name}</Link>)}</nav>
        </details>
        <Link className="store-logo" href="/"><span>Columpio</span><small>STORE</small></Link>
        <nav className="store-desktop-nav" aria-label="Navegación principal">
          <Link href="/">Inicio</Link>{categories.slice(0, 5).map((item) => <Link key={item.slug} href={collectionPath(item.slug)}>{item.name}</Link>)}
        </nav>
        <div className="store-header-actions"><button className="store-icon-button" aria-label="Buscar"><StoreIcon name="search"/></button><button className="store-icon-button store-bag" aria-label="Carrito, próximamente"><StoreIcon name="bag"/><span>0</span></button></div>
      </div>
    </header>
  </>;
}
