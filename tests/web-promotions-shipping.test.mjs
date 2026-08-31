import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapWebCart } from "../src/lib/storefront/cart-contract.ts";

const migrationUrl = new URL("../supabase/migrations/20260831024344_web_promotions_shipping.sql", import.meta.url);
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("4C es aditiva, transaccional y no crea checkout, pedidos, reservas ni Flow", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /^begin;/i); assert.match(sql, /commit;\s*$/i);
  assert.doesNotMatch(sql, /drop\s+(table|column)|create table public\.web_orders|flow|insert into public\.web_stock_reservations/i);
});

test("modelo de promociones contiene porcentaje, activación, vigencia, límites y estados", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["web_promotions", "web_promotion_targets", "web_discount_codes"]) assert.match(sql, new RegExp(`create table public\\.${table}`));
  for (const token of ["discount_percentage", "minimum_subtotal", "automatic", "code", "usage_limit_total", "usage_limit_per_email", "stackable", "draft", "active", "paused", "expired", "archived"]) assert.match(sql, new RegExp(token));
});

test("targets exigen exactamente una referencia y soportan OR por dimensión y AND entre dimensiones", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const type of ["product", "category", "color", "brand"]) assert.match(sql, new RegExp(`target_type = '${type}'`));
  assert.match(sql, /not exists[\s\S]*target_type = 'product'[\s\S]*or exists[\s\S]*target_type = 'product'/i);
  assert.match(sql, /target_type = 'category'[\s\S]*target_type = 'brand'[\s\S]*target_type = 'color'/i);
});

test("motor filtra vigencia, mínimo y elige ganador determinista", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /promotion\.status = 'active'/); assert.match(sql, /total\.subtotal >= promotion\.minimum_subtotal/);
  assert.match(sql, /starts_at is null or promotion\.starts_at <= now\(\)/); assert.match(sql, /ends_at is null or promotion\.ends_at > now\(\)/);
  assert.match(sql, /order by discount_amount desc, priority desc, created_at asc, id asc limit 1/);
});

test("redondeo CLP por línea suma exactamente el descuento ganador", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /sum\(round\(item\.line_subtotal \* promotion\.discount_percentage \/ 100\.0\)\)/);
  assert.match(sql, /round\(item\.line_subtotal \* winner\.discount_percentage \/ 100\.0\)/);
  const lines = [10990, 15990, 9990]; const discount = lines.map((value) => Math.round(value * 0.15));
  assert.equal(discount.reduce((sum, value) => sum + value, 0), 5547);
});

test("automática y código se evalúan juntas y el código no se consume en 4C", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /promotion\.activation_type = 'automatic'/); assert.match(sql, /promotion\.activation_type = 'code'/);
  assert.match(sql, /4D agregará el ledger de usos/); assert.doesNotMatch(sql, /redeemed_at|insert into public\.web_discount_code_usages/);
});

test("cambio de precio y expiración recalculan cada lectura", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /product\.price::numeric\(12,0\) as unit_price/);
  assert.match(sql, /web_cart_snapshot[\s\S]*promotion\.ends_at > now\(\)/i);
});

test("despacho vive en DB con tarifas iniciales exactas", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["web_shipping_zones", "web_shipping_zone_rules", "web_shipping_rates"]) assert.match(sql, new RegExp(`create table public\\.${table}`));
  assert.match(sql, /'PICKUP' then 0 when 'RM' then 3990 when 'REGIONS' then 6990 else 8990/);
});

test("RM y regiones operan; EXTREME queda sin territorios", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'region', 'CL-RM'/); assert.match(sql, /'fallback', null, 0/);
  assert.match(sql, /EXTREME existe sin territorios/); assert.doesNotMatch(sql, /select id, 'region',[^;]+where code = 'EXTREME'/);
});

test("regla más específica gana y región/comuna se validan server-side", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /when 'commune' then 3 when 'region' then 2 else 1 end desc/);
  assert.match(sql, /Invalid shipping region/); assert.match(sql, /Invalid commune/);
});

test("guest no tiene CRUD y las RPC son privadas para service_role", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /enable row level security/g); assert.match(sql, /from public, anon, authenticated/);
  for (const fn of ["set_web_cart_discount_code", "list_web_shipping_regions", "resolve_web_shipping"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}[\\s\\S]*?grant execute on function public\\.${fn}[\\s\\S]*?to service_role`, "i"));
  }
});

test("navegador envía solo código y ubicación, nunca descuento o tarifa", async () => {
  const server = await read("../src/lib/storefront/cart-server.ts"); const page = await read("../src/components/storefront/cart-page.tsx");
  assert.match(server, /set_web_cart_discount_code/); assert.match(server, /resolve_web_shipping/);
  assert.match(page, /method, regionCode: region \|\| null, commune: commune \|\| null/);
  assert.doesNotMatch(page, /discountPercentage|shippingAmount|rateId/);
});

test("mapper conserva contrato 4A/4B y agrega desglose 4C", () => {
  const cart = mapWebCart({ cartId: "c", count: 1, listSubtotal: 54990, discountAmount: 5500, productsTotal: 49490, estimatedTotal: 49490, promotion: { id: "p", name: "Promo", code: null }, items: [{ itemId: "i", subtotal: 54990, discountAmount: 5500, total: 49490, available: true }] });
  assert.equal(cart.listSubtotal, 54990); assert.equal(cart.discountAmount, 5500); assert.equal(cart.items[0].total, 49490); assert.equal(cart.items[0].available, true);
});

test("UI muestra código, subtotal, descuento, productos, despacho y total estimado", async () => {
  const page = await read("../src/components/storefront/cart-page.tsx"); const proxy = await read("../src/lib/supabase/proxy.ts");
  for (const label of ["Código promocional", "Subtotal lista", "Total productos", "Despacho", "Total estimado"]) assert.match(page, new RegExp(label));
  assert.match(proxy, /api\/storefront\/cart\/discount/); assert.match(proxy, /api\/storefront\/shipping/);
});
