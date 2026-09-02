import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260902022745_stable_variants_inventory_adjustments.sql", import.meta.url);
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("P1 reemplaza DELETE+INSERT por variantes estables", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const save = sql.slice(sql.indexOf("create or replace function public.save_catalog_product_stable_core("), sql.indexOf("create or replace function public.adjust_variant_stock("));
  assert.doesNotMatch(save, /delete from public\.product_variants/i);
  assert.match(save, /update public\.product_variants variant set[\s\S]*where variant\.id = requested_variant_id/i);
  assert.match(save, /insert into public\.product_variants[\s\S]*requested_variant_id[\s\S]*0, true/i);
  assert.match(save, /set active = false[\s\S]*not \(variant\.id = any\(submitted_variant_ids\)\)/i);
  assert.doesNotMatch(save, /set stock\s*=/i);
});

test("guardar conserva UUID al cambiar SKU color o talla y no envía stock", async () => {
  const catalog = await source("../src/lib/catalog.ts");
  assert.match(catalog, /id: variant\.id/);
  assert.doesNotMatch(catalog.slice(catalog.indexOf("p_variants:"), catalog.indexOf("p_images:")), /stock:/);
});

test("inventory_movements es inmutable por permisos, auditada e idempotente", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table public\.inventory_movements/);
  assert.match(sql, /variant_id uuid not null references public\.product_variants\(id\) on delete restrict/);
  assert.match(sql, /unique \(actor_user_id, idempotency_key\)/);
  assert.match(sql, /alter table public\.inventory_movements enable row level security/);
  assert.match(sql, /revoke all on table public\.inventory_movements from public, anon, authenticated/);
});

test("adjust_variant_stock bloquea, verifica, impide negativo y registra atómicamente", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const fn = sql.slice(sql.indexOf("create or replace function public.adjust_variant_stock("));
  assert.match(fn, /for update/);
  assert.match(fn, /pg_advisory_xact_lock\(pg_catalog\.hashtextextended/);
  assert.match(fn, /current_stock<>p_expected_stock/);
  assert.match(fn, /new_stock<0/);
  assert.match(fn, /prior\.stock_before<>p_expected_stock/);
  assert.match(fn, /update public\.product_variants set stock=new_stock/);
  assert.match(fn, /insert into public\.inventory_movements/);
  assert.match(fn, /security definer[\s\S]*set search_path = ''/);
});

test("RPC solo authenticated y sin bypass de escritura directa", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke insert, update, delete on table public\.product_variants from authenticated/);
  assert.match(sql, /revoke all on function public\.adjust_variant_stock[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.adjust_variant_stock[\s\S]*to authenticated/);
});

test("UI separa información de variante y ajuste de stock", async () => {
  const form = await source("../src/components/product-form.tsx");
  assert.match(form, /Información de variantes/);
  assert.match(form, /Ajustar stock/);
  assert.match(form, /Stock físico<input readOnly/);
  assert.match(form, /adjustStock\(variant\.id, draft\.delta, variant\.stock, draft\.reason\)/);
});

test("las FK históricas conocidas conservan variant_id", async () => {
  const files = ["006_instagram_cart_and_orders.sql", "20260831015647_web_guest_cart.sql", "20260831022350_web_stock_availability.sql", "20260831030726_web_guest_checkout_orders.sql"];
  for (const file of files) assert.match(await source(`../supabase/migrations/${file}`), /variant_id uuid[^,\n]*references public\.product_variants\(id\)/);
});
