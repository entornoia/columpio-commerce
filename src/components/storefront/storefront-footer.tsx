import Link from "next/link";

export function StorefrontFooter() {
  return <footer className="store-footer"><div className="store-footer-main"><div><Link className="store-logo store-logo-footer" href="/"><span>Columpio</span><small>STORE</small></Link><p>Moda femenina contemporánea, cálida y cercana. Prendas para sentirte tú.</p></div><div><h3>Explora</h3><Link href="/coleccion/vestidos">Vestidos</Link><Link href="/coleccion/blusas">Blusas</Link><Link href="/coleccion/chaquetas">Chaquetas</Link></div><div><h3>Ayuda</h3><Link href="/privacy">Privacidad</Link><Link href="/terms">Términos</Link><span>Despachos y retiro</span></div></div><div className="store-footer-bottom"><span>© 2026 Columpio Store</span><span>Hecho con cariño en Chile</span></div></footer>;
}
