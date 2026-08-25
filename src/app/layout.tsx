import type { Metadata } from "next";
import { Manrope, Playfair_Display } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const sans = Manrope({ variable: "--font-sans", subsets: ["latin"] });
const serif = Playfair_Display({ variable: "--font-serif", subsets: ["latin"] });

export const metadata: Metadata = { title: "Columpio Commerce", description: "Administración de catálogo de Columpio Mujer" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body className={`${sans.variable} ${serif.variable}`}><AppShell>{children}</AppShell></body></html>;
}
