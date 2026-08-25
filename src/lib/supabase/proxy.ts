import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "./config";

export async function updateSession(request: NextRequest) {
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
    const urlToLogin = request.nextUrl.clone();
    urlToLogin.pathname = "/login";
    return NextResponse.redirect(urlToLogin);
  }

  if (data?.claims && isLogin) {
    const urlToDashboard = request.nextUrl.clone();
    urlToDashboard.pathname = "/";
    return NextResponse.redirect(urlToDashboard);
  }

  return response;
}

