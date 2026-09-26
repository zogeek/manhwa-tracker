import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

/**
 * Vérification *optimiste* (cf. doc Next.js « Optimistic checks with Proxy ») : on regarde
 * seulement si un cookie de session existe, sans l'interroger. La vraie vérification
 * (signature, expiration) est faite par `verifySession()` dans chaque page.
 * On ne redirige jamais /login → / sur la seule présence du cookie : un cookie expiré créerait une boucle.
 */
export function proxy(request: NextRequest) {
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  if (!isPublic && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages uniquement : ni le proxy /api, ni les fichiers statiques.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
