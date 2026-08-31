import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "./config";

export async function updateSession(request: NextRequest) {
  const publicPages = ["/", "/privacy", "/terms", "/data-deletion", "/payment-result"];
  const isPublicStorefront = request.nextUrl.pathname.startsWith("/producto/")
    || request.nextUrl.pathname.startsWith("/coleccion/")
    || request.nextUrl.pathname === "/carrito"
    || request.nextUrl.pathname === "/checkout"
    || request.nextUrl.pathname === "/api/storefront/cart"
    || request.nextUrl.pathname.startsWith("/api/storefront/cart/items/")
    || request.nextUrl.pathname === "/api/storefront/cart/discount"
    || request.nextUrl.pathname === "/api/storefront/shipping"
    || request.nextUrl.pathname === "/api/storefront/checkout";
  if (publicPages.includes(request.nextUrl.pathname) || isPublicStorefront) {
    return NextResponse.next({ request });
  }

  // Meta debe poder verificar y entregar eventos sin una sesión administrativa.
  // El POST mantiene su autenticación propia mediante X-Hub-Signature-256.
  if (request.nextUrl.pathname === "/api/webhooks/instagram") {
    return NextResponse.next({ request });
  }

  // Flow necesita callbacks públicos exactos; no se abre ninguna otra ruta API.
  if (["/api/payments/flow/confirmation", "/api/payments/flow/return"].includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  if (!isSupabaseConfigured()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname === "/login";

  if (!data?.claims && !isLogin) {
    if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const urlToLogin = request.nextUrl.clone();
    urlToLogin.pathname = "/login";
    return NextResponse.redirect(urlToLogin);
  }

  if (data?.claims && isLogin) {
    const urlToDashboard = request.nextUrl.clone();
    urlToDashboard.pathname = "/admin";
    return NextResponse.redirect(urlToDashboard);
  }

  return response;
}
