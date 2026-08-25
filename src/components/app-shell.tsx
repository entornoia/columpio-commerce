"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const links = [{ href: "/", label: "Inicio", icon: "home" as const }, { href: "/productos", label: "Productos", icon: "box" as const }, { href: "/productos/nuevo", label: "Agregar producto", icon: "plus" as const }];
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="brand"><span className="brand-mark">C</span><span><strong>Columpio</strong><small>COMMERCE</small></span></Link>
      <nav>{links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</nav>
      <div className="sidebar-foot"><span className="status-dot"/> Catálogo local</div>
    </aside>
    <main className="main-content">{children}</main>
    <nav className="mobile-nav">{links.map((link) => <Link key={link.href} href={link.href} className={pathname === link.href ? "active" : ""}><Icon name={link.icon}/><span>{link.label === "Agregar producto" ? "Agregar" : link.label}</span></Link>)}</nav>
  </div>;
}

