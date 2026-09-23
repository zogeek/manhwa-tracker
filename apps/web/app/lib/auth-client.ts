import { createAuthClient } from "better-auth/react";
import { adminClient } from "better-auth/client/plugins";

// Sans `baseURL`, le client cible l'origine courante + `/api/auth` : les requêtes passent par le proxy Next.js.
export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export const isAdmin = (role: string | null | undefined): boolean =>
  (role ?? "").split(",").some((value) => value.trim() === "admin");
