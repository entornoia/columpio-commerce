"use client";

import { useMemo, useState } from "react";
import type { PublicCatalogVariant } from "@/lib/storefront/catalog-types";
import { useCart } from "./cart-provider";
import { StoreIcon } from "./storefront-icons";

export function ProductPurchase({ variants }: { variants: PublicCatalogVariant[] }) {
  const colors = [...new Set(variants.map((variant) => variant.color))];
  const [color, setColor] = useState(colors[0] ?? "");
  const sizes = useMemo(() => [...new Set(variants.filter((variant) => variant.color === color).map((variant) => variant.size))], [variants, color]);
  const firstAvailableSize = sizes.find((size) => variants.some((variant) => variant.color === color && variant.size === size && variant.available)) ?? sizes[0] ?? "";
  const [size, setSize] = useState(firstAvailableSize);
  const selected = variants.find((variant) => variant.color === color && variant.size === size);
  const { add, loading, error } = useCart();

  function chooseColor(next: string) {
    setColor(next);
    const nextSizes = variants.filter((variant) => variant.color === next);
    setSize(nextSizes.find((variant) => variant.available)?.size ?? nextSizes[0]?.size ?? "");
  }

  return <><div className="store-option"><div><b>Color</b><span>{color || "Por definir"}</span></div><div className="store-color-list">{colors.map((item, index) => <button key={item} className={item === color ? "selected" : ""} onClick={() => chooseColor(item)} aria-label={`Color ${item}`} title={item}><i className={`store-swatch store-swatch-${index % 4}`}/></button>)}</div></div><div className="store-option"><div><b>Talla</b><button className="store-size-guide" type="button">Guía de tallas</button></div><div className="store-size-list">{sizes.map((item) => { const variant = variants.find((entry) => entry.color === color && entry.size === item); return <button key={item} className={item === size ? "selected" : ""} disabled={!variant?.available} onClick={() => setSize(item)}>{item}</button>; })}</div></div><p className={`store-availability ${selected?.available ? "" : "muted"}`}><i/>{selected?.available ? "Disponible" : "Sin disponibilidad"}</p><button className="store-add-button" type="button" disabled={!selected?.available || loading} onClick={() => selected && add(selected.id)}>{loading ? "Actualizando…" : "Agregar al carrito"} <StoreIcon name="bag"/></button>{error && <small className="store-cart-error store-cart-product-error">{error}</small>}</>;
}
