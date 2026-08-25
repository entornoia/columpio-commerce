import { MAX_GARMENT_IMAGE_BYTES } from "../../agent/config";
import { validateGarmentImage } from "../../agent/garment-analysis";

function allowedMetaImageHost(hostname: string) {
  return hostname.endsWith(".fbcdn.net") || hostname.endsWith(".fbsbx.com");
}

export async function fetchInstagramImage(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !allowedMetaImageHost(url.hostname)) throw new Error("La URL de imagen de Instagram no pertenece a un host permitido de Meta.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("No fue posible descargar la imagen de Instagram.");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_GARMENT_IMAGE_BYTES) throw new Error("La imagen de Instagram supera 5 MB.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_GARMENT_IMAGE_BYTES) throw new Error("La imagen de Instagram supera 5 MB.");
  const mime = (response.headers.get("content-type") ?? "").split(";")[0];
  return validateGarmentImage(`data:${mime};base64,${bytes.toString("base64")}`).dataUrl;
}
