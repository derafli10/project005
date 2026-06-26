import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  LOCALE_HEADER_NAME,
} from "@/i18n/config";
import { detectLocale } from "@/i18n/utils";

import type { Locale } from "@/generated/prisma";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { nextUrl } = req;

  const isAuthRoute = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/register");
  const isProtectedRoute = nextUrl.pathname.startsWith("/dashboard") || nextUrl.pathname.startsWith("/classrooms");

  if (isAuthRoute) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/dashboard", nextUrl));
    }
  }

  if (isProtectedRoute) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", nextUrl));
    }
  }

  // ── Locale Resolution ──────────────────────────────────────────────────
  //
  // Priority order:
  //   1. Session-persisted locale (from JWT token, set during login)
  //   2. Cookie-persisted locale (set by LocaleSwitcher on toggle)
  //   3. Accept-Language header auto-detection
  //   4. Fallback to DEFAULT_LOCALE
  //
  // The resolved locale is injected via a custom request header so that
  // downstream Server Components can read it without accessing cookies
  // themselves (which is not possible in some rendering paths).

  let resolvedLocale: Locale = DEFAULT_LOCALE;

  // 1. Check session (JWT carries the locale claim)
  const sessionLocale = (req.auth?.user as { locale?: string } | undefined)?.locale;
  if (sessionLocale === "EN" || sessionLocale === "ID") {
    resolvedLocale = sessionLocale;
  } else {
    // 2. Check cookie
    const cookieLocale = req.cookies.get(LOCALE_COOKIE_NAME)?.value;
    if (cookieLocale === "EN" || cookieLocale === "ID") {
      resolvedLocale = cookieLocale;
    } else {
      // 3. Accept-Language auto-detection
      const acceptLanguage = req.headers.get("accept-language") ?? "";
      if (acceptLanguage) {
        resolvedLocale = detectLocale(acceptLanguage);
      }
    }
  }

  // Inject locale into a custom header that Server Components can read.
  const response = NextResponse.next({
    request: {
      headers: new Headers(req.headers),
    },
  });

  response.headers.set(LOCALE_HEADER_NAME, resolvedLocale);

  // Persist the resolved locale in a cookie so subsequent requests from
  // unauthenticated users retain the preference without re-detection.
  response.cookies.set(LOCALE_COOKIE_NAME, resolvedLocale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
