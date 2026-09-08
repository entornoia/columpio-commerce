import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdministrativeSession } from "@/lib/supabase/admin-auth";
import { listAdminOrders } from "@/lib/admin/orders";

const money = new Intl.NumberFormat("es-CL", { style:"currency", currency:"CLP", maximumFractionDigits:0 });
const date = new Intl.DateTimeFormat("es-CL", { dateStyle:"medium", timeStyle:"short" });

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?:string; q?:string }> }) {
  const { authorized } = await getAdministrativeSession();
  if (!authorized) redirect("/login");
  const [{ filter = "all", q = "" }, orders] = await Promise.all([searchParams, listAdminOrders()]);
  const needle=q.trim().toLowerCase();
  const filtered=orders.filter((order)=>{
    const matchesSearch=!needle||`${order.orderNumber} ${order.email} ${order.customerName}`.toLowerCase().includes(needle);
    const matchesFilter=filter==="all"
      || (filter==="expired_cancelled" && ["expired","cancelled"].includes(order.orderStatus))
      || (filter==="fulfillment" && order.orderStatus==="paid" && order.fulfillmentStatus!=="delivered")
      || order.orderStatus===filter;
    return matchesSearch&&matchesFilter;
  });
  const filters=[["all","Todos"],["pending_payment","Pendientes"],["paid","Pagados"],["payment_review","Revisión"],["expired_cancelled","Expirados/cancelados"],["fulfillment","Fulfillment"]];
  return <div className="page-wrap orders-page"><header className="page-header"><div><span className="eyebrow">OPERACIÓN WEB</span><h1>Pedidos</h1><p>{orders.length} pedidos registrados.</p></div></header>
    <form className="orders-toolbar"><label className="search"><span aria-hidden>⌕</span><input name="q" defaultValue={q} placeholder="Pedido, email o nombre"/></label><input type="hidden" name="filter" value={filter}/><button className="secondary-button" type="submit">Buscar</button></form>
    <nav className="order-filter-tabs" aria-label="Filtros de pedidos">{filters.map(([value,label])=><Link key={value} className={filter===value?"active":""} href={`/pedidos?filter=${value}${q?`&q=${encodeURIComponent(q)}`:""}`}>{label}</Link>)}</nav>
    <div className="orders-list"><div className="orders-head"><span>Pedido</span><span>Cliente</span><span>Total</span><span>Pago / pedido</span><span>Entrega</span></div>{filtered.map((order)=><Link href={`/pedidos/${order.id}`} className={`order-row ${order.orderStatus==="payment_review"||order.stockException?"attention":""}`} key={order.id}><div><strong>{order.orderNumber}</strong><small>{date.format(new Date(order.createdAt))}</small></div><div><strong>{order.customerName}</strong><small>{order.email}</small></div><b>{money.format(order.total)}</b><div><span className={`order-status ${order.paymentStatus}`}>{order.paymentStatus}</span><small>{order.orderStatus}</small></div><div><strong>{order.deliveryType==="pickup"?"Retiro":"Despacho"}</strong><small>{order.fulfillmentStatus}</small></div>{(order.orderStatus==="payment_review"||order.stockException)&&<em>Requiere revisión</em>}</Link>)}{filtered.length===0&&<div className="empty-state">No hay pedidos para estos filtros.</div>}</div>
  </div>;
}
