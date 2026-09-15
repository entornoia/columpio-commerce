const POSTGRES_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPostgresUuid(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && POSTGRES_UUID_PATTERN.test(value);
}

export function isProductImageStoragePath(path: string, productId: string, imageId: string) {
  if (!isPostgresUuid(productId) || !isPostgresUuid(imageId)) return false;
  const prefix = `${productId}/${imageId}.`;
  if (!path.toLowerCase().startsWith(prefix.toLowerCase())) return false;
  return ["jpg", "jpeg", "png", "webp"].includes(path.slice(prefix.length).toLowerCase());
}
