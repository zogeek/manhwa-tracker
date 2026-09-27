import "server-only";

import { createAuthClient } from "better-auth/client";
import { adminClient } from "better-auth/client/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ROUTES } from "./routes";

// Data Access Layer : seul point d'accès à la session côté serveur (Server Components).
// `server-only` fait échouer le build si un Client Component importe ce module.

const apiUrl = (process.env.API_INTERNAL_URL ?? "http://localhost:3001").replace(/\/+$/, "");

// Client Better Auth *serveur* : il interroge directement l'API (réseau interne, sans proxy).
const serverAuthClient = createAuthClient({
  baseURL: `${apiUrl}/api/auth`,
  plugins: [adminClient()],
});

export type Session = typeof serverAuthClient.$Infer.Session;

/** En-têtes à relayer vers l'API pour agir au nom de l'utilisateur : uniquement son cookie. */
export const getForwardedAuthHeaders = cache(async (): Promise<{ cookie: string }> => {
  const cookie = (await headers()).get("cookie") ?? "";
  return { cookie };
});

/** Session vérifiée par l'API (cookie signé), ou `null`. Mémoïsée pour un même rendu. */
export const getSession = cache(async (): Promise<Session | null> => {
  const { data } = await serverAuthClient.getSession({
    fetchOptions: { headers: await getForwardedAuthHeaders() },
  });
  return data ?? null;
});

/** Garde des pages protégées : renvoie la session ou redirige vers /login. */
export const verifySession = cache(async (): Promise<Session> => {
  const session = await getSession();
  if (!session) redirect(ROUTES.login);
  return session;
});
