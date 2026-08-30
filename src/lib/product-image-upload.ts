"use client";

import type { ProductImage } from "./types";
import { createClient } from "./supabase/client";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
};

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("No se pudieron leer las dimensiones de la imagen."));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export function validateProductImageFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions = MIME_EXTENSIONS[file.type];
  if (!allowedExtensions || !allowedExtensions.includes(extension)) return "Usa un archivo JPEG, PNG o WebP con una extensión compatible.";
  if (file.size <= 0 || file.size > MAX_PRODUCT_IMAGE_SIZE) return "Cada imagen debe pesar como máximo 5 MiB.";
  return null;
}

export async function uploadProductImage({ file, productId, productName, onStatus }: {
  file: File; productId: string; productName: string; onStatus?: (status: string) => void;
}): Promise<ProductImage> {
  const validationError = validateProductImageFile(file);
  if (validationError) throw new Error(validationError);
  const sourceExtension = file.name.split(".").pop()!.toLowerCase();
  const extension = sourceExtension === "jpeg" ? "jpg" : sourceExtension;
  const imageId = crypto.randomUUID();
  const storagePath = `${productId}/${imageId}.${extension}`;
  const supabase = createClient();
  const publicUrl = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
  const dimensions = await imageDimensions(file);
  onStatus?.("Reservando…");
  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_product_image_upload", {
    p_product_id: productId, p_image_id: imageId, p_extension: extension, p_image_url: publicUrl,
    p_mime_type: file.type, p_file_size: file.size, p_width: dimensions.width,
    p_height: dimensions.height, p_alt_text: productName,
  });
  if (reserveError) throw new Error(reserveError.message);
  onStatus?.("Subiendo…");
  const { error: uploadError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    await supabase.rpc("fail_product_image_upload", { p_image_id: imageId });
    throw new Error(uploadError.message);
  }
  onStatus?.("Finalizando…");
  const { error: finalizeError } = await supabase.rpc("finalize_product_image_upload", { p_image_id: imageId });
  if (finalizeError) {
    const cleanup = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
    await supabase.rpc("fail_product_image_upload", { p_image_id: imageId });
    throw new Error(cleanup.error ? `${finalizeError.message}; además falló la limpieza: ${cleanup.error.message}` : finalizeError.message);
  }
  const row = Array.isArray(reserved) ? reserved[0] : reserved;
  onStatus?.("Lista");
  return {
    id: imageId, imageUrl: publicUrl, position: Number(row?.image_position ?? 0), altText: productName,
    storageBucket: PRODUCT_IMAGE_BUCKET, storagePath, mimeType: file.type, width: dimensions.width,
    height: dimensions.height, fileSize: file.size, status: "ready",
  };
}
