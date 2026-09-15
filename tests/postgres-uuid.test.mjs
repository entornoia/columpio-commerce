import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isPostgresUuid, isProductImageStoragePath } from "../src/lib/postgres-uuid.ts";

const managementRoute = await readFile(new URL("../src/app/api/admin/products/[id]/management/route.ts", import.meta.url), "utf8");
const technicalRoute = await readFile(new URL("../src/app/api/admin/products/[id]/draft-deletion/route.ts", import.meta.url), "utf8");

const importedProductIds = [
  "10000000-0000-0000-0000-000000000001",
  "10000000-0000-0000-0000-000000000002",
  "10000000-0000-0000-0000-000000000003",
];

test("acepta UUID RFC y UUID canónicos deterministas almacenados por PostgreSQL", () => {
  assert.equal(isPostgresUuid("9d834cbe-b115-4951-ba27-f67f7d4b6b0f"), true);
  for (const productId of importedProductIds) assert.equal(isPostgresUuid(productId), true);
  assert.equal(isPostgresUuid(importedProductIds[0].toUpperCase()), true);
});

test("rechaza sintaxis que PostgreSQL uuid no acepta como representación canónica", () => {
  for (const invalid of [
    "10000000-0000-0000-0000-00000000000g",
    "10000000-0000-0000-0000-00000000001",
    "10000000000000000000000000000001",
    "10000000/0000/0000/0000/000000000001",
    "../10000000-0000-0000-0000-000000000001",
    "10000000-0000-0000-0000-000000000001\n",
    "",
  ]) assert.equal(isPostgresUuid(invalid), false);
});

test("el path Storage permanece ligado exactamente al producto e imagen", () => {
  const productId = importedProductIds[0];
  const imageId = "9d834cbe-b115-4951-ba27-f67f7d4b6b0f";
  assert.equal(isProductImageStoragePath(`${productId}/${imageId}.png`, productId, imageId), true);
  assert.equal(isProductImageStoragePath(`../${productId}/${imageId}.png`, productId, imageId), false);
  assert.equal(isProductImageStoragePath(`${importedProductIds[1]}/${imageId}.png`, productId, imageId), false);
  assert.equal(isProductImageStoragePath(`${productId}/${imageId}.svg`, productId, imageId), false);
  assert.equal(isProductImageStoragePath(`${productId}/${imageId}.png\n`, productId, imageId), false);
});

test("las rutas admin reutilizan el helper sin debilitar autenticación ni same-origin", () => {
  for (const route of [managementRoute, technicalRoute]) {
    assert.match(route, /isPostgresUuid/);
    assert.match(route, /isProductImageStoragePath/);
    assert.doesNotMatch(route, /\[1-5\]\[0-9a-f\]/);
    assert.match(route, /getAdministrativeSession/);
    assert.match(route, /assertSameOrigin\(request\)/);
    assert.match(route, /p_product_id: identity\.id/);
  }
});
