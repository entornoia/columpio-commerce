import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { searchCatalog } from "../src/lib/catalog-search.ts";

const migrationUrl = new URL("../supabase/migrations/20260831022350_web_stock_availability.sql", import.meta.url);
const sql = async () => readFile(migrationUrl, "utf8");

test("4B crea reservas vinculadas al carrito sin anticipar web_orders", async () => {
  const source = await sql();
  assert.match(source, /create table public\.web_stock_reservations/);
  assert.match(source, /cart_id uuid not null references public\.web_carts\(id\) on delete restrict/);
  assert.match(source, /create table public\.web_stock_reservation_items/);
  assert.doesNotMatch(source, /create table public\.web_orders|order_id/);
});

test("estados y timestamps de reserva son coherentes", async () => {
  const source = await sql();
  assert.match(source, /'active', 'consumed', 'released', 'expired'/);
  assert.match(source, /status = 'consumed' and consumed_at is not null/);
  assert.match(source, /status in \('released', 'expired'\)[\s\S]*released_at is not null/);
  assert.match(source, /expires_at > created_at/);
});

test("una variante aparece una vez por reserva y quantity siempre es positiva", async () => {
  const source = await sql();
  assert.match(source, /primary key \(reservation_id, variant_id\)/);
  assert.match(source, /quantity integer not null check \(quantity > 0\)/);
});

test("disponibilidad deriva físico menos reservas active no vencidas", async () => {
  const source = await sql();
  const fn = source.slice(source.indexOf("create or replace function public.web_variant_available_stock"), source.indexOf("create or replace function public.lock_web_stock_variants"));
  assert.match(fn, /variant\.stock - coalesce/);
  assert.match(fn, /sum\(item\.quantity\)/);
  assert.match(fn, /reservation\.status = 'active'/);
  assert.match(fn, /reservation\.expires_at > now\(\)/);
});

test("released, consumed y active vencida no reducen disponibilidad", async () => {
  const source = await sql();
  const fn = source.slice(source.indexOf("create or replace function public.web_variant_available_stock"), source.indexOf("create or replace function public.lock_web_stock_variants"));
  assert.doesNotMatch(fn, /status in \('active', 'consumed'\)|status <> 'released'/);
  assert.match(fn, /status = 'active'/); assert.match(fn, /expires_at > now\(\)/);
});

test("múltiples reservas se suman y disponibilidad nunca es negativa", async () => {
  const source = await sql();
  assert.match(source, /select greatest\([\s\S]*variant\.stock - coalesce/);
  assert.match(source, /sum\(item\.quantity\)::integer/);
  const tables = source.slice(source.indexOf("create table public.web_stock_reservations"), source.indexOf("create or replace function public.web_variant_available_stock"));
  assert.doesNotMatch(tables, /reserved_stock (integer|numeric)|available_stock (integer|numeric)/);
});

test("carrito revalida snapshot, add y set contra available stock", async () => {
  const source = await sql();
  assert.match(source, /web_variant_available_stock\(variant\.id\) >= item\.quantity/);
  assert.match(source, /target_quantity > selected_variant\.available_stock/);
  assert.match(source, /p_quantity > selected_variant\.available_stock/);
  assert.doesNotMatch(source, /target_quantity > selected_variant\.stock/);
});

test("storefront usa disponibilidad calculada sin exponer cantidad", async () => {
  const source = await sql();
  const publicFunctions = source.slice(source.indexOf("create or replace function public.list_public_products"), source.indexOf("create or replace function public.web_cart_snapshot"));
  assert.match(publicFunctions, /web_variant_available_stock/);
  assert.match(publicFunctions, /'available', \(public\.web_variant_available_stock\(variant\.id\) > 0\)/);
  assert.doesNotMatch(publicFunctions, /'stock'|'available_stock'|'reserved_stock'|'physical_stock'/);
});

test("advisor obtiene disponibilidad calculada y falla cerrado si es inconsistente", async () => {
  const product = { id: "p", sku: "P", name: "Blazer", description: "", category: "Chaquetas", subcategory: "Blazers", price: 54990, style: "", season: "", formality: "", fit: "", material: "", occasions: [], active: true, created_at: "", updated_at: "", product_images: [], product_variants: [{ id: "v", variant_sku: "V", color: "Camel", size: "M", stock: 3, active: true }] };
  const supabase = {
    from() { return { select() { return { order: async () => ({ data: [structuredClone(product)], error: null }) }; } }; },
    async rpc(name, args) { assert.equal(name, "get_catalog_variant_availability"); assert.deepEqual(args.p_variant_ids, ["v"]); return { data: [{ variant_id: "v", available_stock: 1 }], error: null }; },
  };
  const result = await searchCatalog(supabase, { active: true, inStock: true });
  assert.equal(result[0].compatibleVariants[0].stock, 1);
  assert.equal(result[0].compatibleStock, 1);
});

test("advisor no cae silenciosamente a stock físico si falla disponibilidad", async () => {
  const product = { id: "p", sku: "P", name: "Blazer", description: "", category: "Chaquetas", subcategory: "Blazers", price: 54990, style: "", season: "", formality: "", fit: "", material: "", occasions: [], active: true, created_at: "", updated_at: "", product_images: [], product_variants: [{ id: "v", variant_sku: "V", color: "Camel", size: "M", stock: 3, active: true }] };
  const supabase = { from() { return { select() { return { order: async () => ({ data: [product], error: null }) }; } }; }, async rpc() { return { data: null, error: { message: "unavailable" } }; } };
  await assert.rejects(searchCatalog(supabase, { inStock: true }), /calcular la disponibilidad/);
});

test("RPC de advisor no está disponible para anon", async () => {
  const source = await sql();
  assert.match(source, /revoke all on function public\.get_catalog_variant_availability\(uuid\[\]\) from public, anon, authenticated/);
  assert.match(source, /grant execute on function public\.get_catalog_variant_availability\(uuid\[\]\) to authenticated, service_role/);
});

test("concurrencia futura bloquea variantes en orden determinista y rechaza duplicados/faltantes", async () => {
  const source = await sql();
  const fn = source.slice(source.indexOf("create or replace function public.lock_web_stock_variants"), source.indexOf("create or replace function public.get_catalog_variant_availability"));
  assert.match(fn, /order by variant\.id[\s\S]*for update/);
  assert.match(fn, /count\(distinct requested\.value\)/);
  assert.match(fn, /locked_count <> requested_count/);
  assert.doesNotMatch(fn, /insert into public\.web_stock_reservations/);
});

test("4B no consume stock ni incorpora checkout, pedidos, promociones, despacho o Flow", async () => {
  const source = (await sql()).toLowerCase();
  assert.doesNotMatch(source, /update public\.product_variants\s+set stock/);
  assert.doesNotMatch(source, /flow|promotion|discount|shipping|create table public\.web_orders/);
});

test("reservas mantienen RLS y funciones sensibles quedan privadas", async () => {
  const source = await sql();
  assert.match(source, /alter table public\.web_stock_reservations enable row level security/);
  assert.match(source, /revoke all on table public\.web_stock_reservations, public\.web_stock_reservation_items from public, anon, authenticated/);
  assert.match(source, /revoke all on function public\.lock_web_stock_variants\(uuid\[\]\) from public, anon, authenticated/);
});
