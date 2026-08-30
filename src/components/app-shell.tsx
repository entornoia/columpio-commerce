"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { createClient } from "@/lib/supabase/client";
import { CatalogProvider } from "./catalog-provider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPages = ["/", "/login", "/privacy", "/terms", "/data-deletion", "/payment-result"];
  const isStorefront = pathname.startsWith("/producto/") || pathname.startsWith("/coleccion/");
  if (publicPages.includes(pathname) || isStorefront) return children;
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  const links = [{ href: "/admin", label: "Inicio", icon: "home" as const }, { href: "/productos", label: "Productos", icon: "box" as const }, { href: "/catalog-search", label: "Buscar catálogo", icon: "search" as const }, { href: "/agent-test", label: "Agente vendedor", icon: "layers" as const }, { href: "/instagram-conversations", label: "Instagram", icon: "layers" as const }, { href: "/productos/nuevo", label: "Agregar producto", icon: "plus" as const }];
  return <CatalogProvider><div className="app-shell">
    <aside className="sidebar">
      <Link href="/admin" className="brand"><span className="brand-mark">C</span><span><strong>Columpio</strong><small>COMMERCE</small></span></Link>
      <nav>{links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</nav>
      <div className="sidebar-foot"><div><span className="status-dot"/> Supabase conectado</div><button onClick={logout}>Cerrar sesión</button></div>
    </aside>
    <main className="main-content">{children}</main>
    <nav className="mobile-nav">{links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}><Icon name={link.icon}/><span>{link.label === "Agregar producto" ? "Agregar" : link.label === "Buscar catálogo" ? "Buscar" : link.label === "Agente vendedor" ? "Agente" : link.label}</span></Link>)}</nav>
  </div></CatalogProvider>;
}
