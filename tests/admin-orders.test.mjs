import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root=new URL("../",import.meta.url);
const migration=new URL("../supabase/migrations/20260907230052_web_order_admin_fulfillment.sql",import.meta.url);
const read=(path)=>readFile(new URL(path,root),"utf8");

test("P2 es aditiva, transaccional y no cambia pagos ni snapshots",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/^begin;/);assert.match(sql,/commit;\s*$/);
  assert.doesNotMatch(sql,/drop\s+(table|column)|alter\s+table\s+public\.web_(payments|orders)\s+(drop|alter\s+column)/i);
  assert.doesNotMatch(sql,/update\s+public\.web_payments|set\s+(status|total|items_subtotal|discount_total|shipping_total)\s*=/i);
});

test("ledger administrativo es inmutable, auditado y sin CRUD del navegador",async()=>{
  const sql=await readFile(migration,"utf8");
  for(const field of ["order_id","event_type","from_status","to_status","actor_user_id","note","created_at"])assert.match(sql,new RegExp(field));
  assert.match(sql,/references auth\.users\(id\) on delete restrict/);
  assert.match(sql,/before update or delete on public\.web_order_admin_events/);
  assert.match(sql,/raise exception 'Order administration events are immutable'/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on table public\.web_order_admin_events from public, anon, authenticated/);
});

test("transiciones fulfillment respetan pago y modalidad",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/selected_order\.status <> 'paid'/);
  assert.match(sql,/selected_payment\.status <> 'paid' or selected_payment\.stock_exception/);
  assert.match(sql,/unfulfilled' and p_to_status = 'preparing'/);
  assert.match(sql,/delivery_type = 'pickup'.*ready_for_pickup/s);
  assert.match(sql,/delivery_type = 'shipping'.*p_to_status = 'shipped'/s);
  assert.match(sql,/p_expected_status = 'shipped' and p_to_status = 'delivered'/);
  assert.doesNotMatch(sql,/pickup'.*p_to_status = 'shipped'/);
  assert.doesNotMatch(sql,/shipping'.*p_to_status = 'ready_for_pickup'/);
});

test("transición bloquea pedido, compara estado y registra actor",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/where orders\.id = p_order_id\s+for update/);
  assert.match(sql,/fulfillment_status <> p_expected_status/);
  assert.match(sql,/where id = selected_order\.id and fulfillment_status = p_expected_status/);
  assert.match(sql,/actor_id uuid := p_actor_user_id/);
  assert.match(sql,/from auth\.users users where users\.id = actor_id/);
  assert.match(sql,/values\(selected_order\.id,'fulfillment_status_changed',p_expected_status,p_to_status,actor_id,normalized_note\)/);
});

test("RPC sensible tiene search_path seguro y contrato authenticated",async()=>{
  const sql=await readFile(migration,"utf8");
  assert.match(sql,/transition_web_order_fulfillment[\s\S]*security definer[\s\S]*set search_path = ''/);
  assert.match(sql,/alter function public\.transition_web_order_fulfillment\(uuid,text,text,uuid,text\) owner to postgres/);
  assert.match(sql,/revoke all on function public\.transition_web_order_fulfillment\(uuid,text,text,uuid,text\) from public, anon, authenticated/);
  assert.match(sql,/grant execute on function public\.transition_web_order_fulfillment\(uuid,text,text,uuid,text\) to service_role/);
});

test("listado incluye filtros, búsqueda y alertas operacionales",async()=>{
  const page=await read("src/app/pedidos/page.tsx");
  for(const value of ["pending_payment","paid","payment_review","expired_cancelled","fulfillment"])assert.match(page,new RegExp(value));
  assert.match(page,/orderNumber} \$\{order\.email} \$\{order\.customerName}/);
  assert.match(page,/stockException/);assert.match(page,/Requiere revisión/);
});

test("detalle se reconstruye desde snapshots y trazabilidad persistida",async()=>{
  const repository=await read("src/lib/admin/orders.ts");const page=await read("src/app/pedidos/[id]/page.tsx");
  for(const table of ["web_order_customers","web_order_addresses","web_order_items","web_order_discounts","web_payments","web_payment_attempts","web_payment_events","web_stock_reservations","web_order_admin_events"])assert.match(repository,new RegExp(table));
  assert.doesNotMatch(repository,/from\("products"\)|from\("product_variants"\)/);
  assert.match(page,/PRODUCTOS · SNAPSHOT/);assert.match(page,/CLIENTE · SNAPSHOT/);assert.match(page,/ENTREGA · SNAPSHOT/);
  assert.doesNotMatch(page,/flow_token|payload/);
});

test("mutación ocurre server-side con sesión, same-origin y sin editar pagos",async()=>{
  const route=await read("src/app/api/admin/orders/[id]/fulfillment/route.ts");
  assert.match(route,/assertSameOrigin\(request\)/);assert.match(route,/getAdministrativeSession/);assert.match(route,/createServiceClient/);assert.match(route,/p_actor_user_id:user\.id/);assert.match(route,/transition_web_order_fulfillment/);
  assert.doesNotMatch(route,/web_payments|payment_status|items_subtotal|shipping_total/);
});

test("sidebar incorpora Pedidos sin retirar administración existente",async()=>{
  const shell=await read("src/components/app-shell.tsx");
  assert.match(shell,/href: "\/pedidos", label: "Pedidos"/);
  for(const route of ["/admin","/productos","/catalog-search","/agent-test","/instagram-conversations"])assert.match(shell,new RegExp(route.replace("/","\\/")));
});
