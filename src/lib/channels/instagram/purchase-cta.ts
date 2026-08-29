const allowedStoreHosts = new Set(["columpiostore.cl", "www.columpiostore.cl"]);

function validatedStoreUrl(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !allowedStoreHosts.has(url.hostname.toLocaleLowerCase("es-CL"))) return null;
    url.username = ""; url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

export type InstagramPurchasableProduct = { canonicalUrl?: string | null };

export function resolveInstagramPurchaseUrl(product?: InstagramPurchasableProduct | null) {
  return validatedStoreUrl(product?.canonicalUrl) ?? validatedStoreUrl(process.env.STORE_WEB_URL);
}

export function formatInstagramPurchaseCta(product?: InstagramPurchasableProduct | null) {
  const url = resolveInstagramPurchaseUrl(product);
  return url
    ? `Perfecto 💛 Puedes comprarla directamente en nuestra tienda online: ${url}`
    : "Puedes comprarla en nuestra tienda online, pero el enlace no está disponible en este momento.";
}
