import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EMPTY_WEB_CART, mapWebCart, positiveQuantity, uuid } from "../src/lib/storefront/cart-contract.ts";
import { assertTrustedRequestOrigin, publicAppOrigin, usesSecurePublicCookies } from "../src/lib/public-origin.ts";

const migrationUrl = new URL("../supabase/migrations/20260831015647_web_guest_cart.sql", import.meta.url);
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("4A crea únicamente tablas web y no reutiliza el comercio legacy", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();
  for (const table of ["web_sessions", "web_carts", "web_cart_items"]) assert.match(sql, new RegExp(`create table public\\.${table}`));
  assert.doesNotMatch(sql, /alter table public\.commerce_(carts|orders)/);
  assert.doesNotMatch(sql, /commerce_flow_checkouts/);
});

test("la migración es transaccional, aditiva y sin operaciones destructivas", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).trim().toLowerCase();
  assert.ok(sql.startsWith("begin;")); assert.ok(sql.endsWith("commit;"));
  assert.doesNotMatch(sql, /\bdrop\s+(table|column|function|type)\b/);
});

test("sesión guarda hash único y estados/expiración", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /token_hash text not null unique/); assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(sql, /'active', 'rotated', 'expired'/); assert.match(sql, /last_seen_at/); assert.doesNotMatch(sql, /raw_token|session_token text/);
});

test("un carrito abierto por sesión y un item por variante", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /unique index web_carts_one_open_per_session_idx[\s\S]*where status = 'open'/);
  assert.match(sql, /unique \(cart_id, variant_id\)/); assert.match(sql, /quantity integer not null check \(quantity > 0\)/);
});

test("items no almacenan precio y snapshot usa products.price vigente", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const table = sql.match(/create table public\.web_cart_items \([\s\S]*?\n\);/)?.[0] ?? "";
  assert.doesNotMatch(table, /price|subtotal/); assert.match(sql, /product\.price as unit_price/); assert.match(sql, /product\.price \* item\.quantity as subtotal/);
});

test("RLS bloquea anon/authenticated y RPC privadas son solo service_role", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /enable row level security/g); assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated/);
  for (const fn of ["web_cart_snapshot", "get_web_cart", "mutate_web_cart"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([\\s\\S]*?from public, anon, authenticated`));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([\\s\\S]*?to service_role`));
  }
});

test("la sesión se crea solo al primer add mutante", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /if not \(p_create_session and p_operation = 'add'\)/);
  const provider = await read("../src/components/storefront/cart-provider.tsx");
  assert.match(provider, /cartRequest\("\/api\/storefront\/cart"\)/);
});

test("cookie es HttpOnly, SameSite Lax, segura con origen público y de alta entropía", async () => {
  const server = await read("../src/lib/storefront/cart-server.ts");
  assert.match(server, /randomBytes\(32\)/); assert.match(server, /createHash\("sha256"\)/);
  assert.match(server, /httpOnly: true/); assert.match(server, /sameSite: "lax"/); assert.match(server, /secure: usesSecurePublicCookies\(\)/); assert.match(server, /path: "\/"/);
  assert.equal(usesSecurePublicCookies("development", "https://badge-outpost-chaplain.ngrok-free.dev"), true);
  assert.equal(usesSecurePublicCookies("development", undefined), false);
  assert.equal(usesSecurePublicCookies("production", undefined), true);
});

test("APP_BASE_URL público se valida una vez y normaliza el origen", () => {
  assert.equal(publicAppOrigin("https://badge-outpost-chaplain.ngrok-free.dev/"), "https://badge-outpost-chaplain.ngrok-free.dev");
  for (const value of ["http://columpiostore.cl", "https://localhost:3000", "https://127.0.0.1", "https://10.0.0.2", "https://store.local"]) {
    assert.throws(() => publicAppOrigin(value), /HTTPS público/);
  }
});

test("same-origin acepta origen directo o APP_BASE_URL exacto y rechaza forwarded headers", () => {
  assert.doesNotThrow(() => assertTrustedRequestOrigin(new Request("http://localhost:3000/api/storefront/cart", { headers: { origin: "http://localhost:3000" } }), null));
  assert.doesNotThrow(() => assertTrustedRequestOrigin(new Request("http://localhost:3000/api/storefront/cart", { headers: { origin: "https://badge-outpost-chaplain.ngrok-free.dev" } }), "https://badge-outpost-chaplain.ngrok-free.dev"));
  assert.throws(() => assertTrustedRequestOrigin(new Request("http://localhost:3000/api/storefront/cart", { headers: { origin: "https://evil.example", "x-forwarded-host": "badge-outpost-chaplain.ngrok-free.dev", "x-forwarded-proto": "https" } }), "https://badge-outpost-chaplain.ngrok-free.dev"), /Origen no permitido/);
  assert.throws(() => assertTrustedRequestOrigin(new Request("http://localhost:3000/api/storefront/cart", { headers: { "x-forwarded-host": "badge-outpost-chaplain.ngrok-free.dev", "x-forwarded-proto": "https" } }), "https://badge-outpost-chaplain.ngrok-free.dev"), /Origen no permitido/);
});

test("allowedDevOrigins usa solo el hostname público explícito y no abre producción", async () => {
  const config = await read("../next.config.ts");
  assert.match(config, /process\.env\.NODE_ENV === "development"/);
  assert.match(config, /allowedDevOrigins: publicOrigin \? \[new URL\(publicOrigin\)\.hostname\] : undefined/);
  assert.doesNotMatch(config, /allowedDevOrigins:[\s\S]*\*\./);
  assert.doesNotMatch(config, /x-forwarded|headers\(/i);
});

test("GET no crea cookie y POST exitoso conserva creación exclusiva de sesión", async () => {
  const route = await read("../src/app/api/storefront/cart/route.ts");
  const getHandler = route.match(/export async function GET[\s\S]*?\n\}/)?.[0] ?? "";
  const postHandler = route.match(/export async function POST[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(getHandler, /cookies\.set|mutateCart/);
  assert.match(postHandler, /assertSameOrigin\(request\)/);
  assert.match(postHandler, /if \(result\.createdToken\) response\.cookies\.set\(CART_COOKIE/);
});

test("mutaciones exigen mismo origen y validan UUID/cantidad", async () => {
  const route = await read("../src/app/api/storefront/cart/route.ts");
  const itemRoute = await read("../src/app/api/storefront/cart/items/[itemId]/route.ts");
  assert.match(route, /assertSameOrigin\(request\)/); assert.match(itemRoute, /assertSameOrigin\(request\)/);
  assert.equal(positiveQuantity(2), 2); assert.throws(() => positiveQuantity(0)); assert.throws(() => positiveQuantity(1.5));
  assert.equal(uuid("123e4567-e89b-42d3-a456-426614174000", "id"), "123e4567-e89b-42d3-a456-426614174000"); assert.throws(() => uuid("bad", "id"));
});

test("add valida publicación, pertenencia, actividad y stock físico", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /variant\.id = p_variant_id and variant\.active and product\.active and product\.publication_status = 'published'/);
  assert.match(sql, /category\.brand_id = brand\.id/); assert.match(sql, /target_quantity > selected_variant\.stock/);
});

test("carrito no reserva ni descuenta stock", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();
  assert.doesNotMatch(sql, /update public\.product_variants\s+set stock/); assert.doesNotMatch(sql, /reservation|reserved_stock|inventory/);
});

test("add repetido incrementa, set controla stock y remove/clear respetan propiedad", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /on conflict \(cart_id, variant_id\) do update set quantity = excluded\.quantity \+ public\.web_cart_items\.quantity/);
  assert.match(sql, /p_quantity > selected_variant\.stock/); assert.match(sql, /item\.cart_id = selected_cart\.id/);
  assert.match(sql, /delete from public\.web_cart_items where id = p_item_id and cart_id = selected_cart\.id/);
  assert.match(sql, /delete from public\.web_cart_items where cart_id = selected_cart\.id/);
});

test("cada snapshot revalida precio, publicación y disponibilidad física", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /product\.active and product\.publication_status = 'published'/);
  assert.match(sql, /variant\.stock >= item\.quantity/); assert.match(sql, /product\.price as unit_price/);
  const provider = await read("../src/components/storefront/cart-provider.tsx");
  assert.match(provider, /async openDrawer\(\) \{ await refresh\(\)/); assert.match(provider, /\[pathname\]/);
});

test("RPC pública expone variant id sin SKU ni stock exacto", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const publicRpc = sql.slice(sql.lastIndexOf("create or replace function public.get_public_product_by_slug"));
  assert.match(publicRpc, /'id', variant\.id/); assert.match(publicRpc, /'available', \(variant\.stock > 0\)/);
  assert.doesNotMatch(publicRpc, /'stock'|'sku'|variant_sku/);
});

test("UI tiene selector real, drawer, contador y página carrito sin checkout", async () => {
  const [purchase, provider, page, header] = await Promise.all([
    read("../src/components/storefront/product-purchase.tsx"), read("../src/components/storefront/cart-provider.tsx"),
    read("../src/components/storefront/cart-page.tsx"), read("../src/components/storefront/storefront-header.tsx"),
  ]);
  assert.match(purchase, /selected\.id/); assert.match(purchase, /disabled=\{!selected\?\.available/);
  assert.match(provider, /store-cart-drawer/); assert.match(header, /cart\.count/); assert.match(page, /Total estimado/);
  assert.match(page, /Continuar al checkout/); assert.match(page, /disabled/); assert.doesNotMatch(page, /Flow|pagar/i);
});

test("mapper normaliza snapshot seguro", () => {
  assert.deepEqual(mapWebCart(null), EMPTY_WEB_CART);
  const cart = mapWebCart({ cartId: "c", count: 2, estimatedTotal: 19980, items: [{ itemId: "i", productId: "p", variantId: "v", name: "Blazer", slug: "blazer", color: "Negro", size: "M", unitPrice: 9990, quantity: 2, subtotal: 19980, available: true }] });
  assert.equal(cart.count, 2); assert.equal(cart.items[0].unitPrice, 9990); assert.equal(cart.items[0].available, true);
});

test("proxy abre solo las rutas públicas exactas del carrito web", async () => {
  const proxy = await read("../src/lib/supabase/proxy.ts");
  const shell = await read("../src/components/app-shell.tsx");
  assert.match(proxy, /pathname === "\/carrito"/); assert.match(proxy, /pathname === "\/api\/storefront\/cart"/); assert.match(proxy, /startsWith\("\/api\/storefront\/cart\/items\/"\)/);
  assert.match(shell, /pathname === "\/carrito"/);
});

test("4A no modifica Flow ni advisor Instagram", async () => {
  const sql = (await readFile(migrationUrl, "utf8")).toLowerCase();
  assert.doesNotMatch(sql, /flow|instagram|commerce_orders|commerce_carts/);
});
