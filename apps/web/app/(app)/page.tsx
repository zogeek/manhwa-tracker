import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/app/lib/api";
import { getForwardedAuthHeaders, verifySession } from "@/app/lib/dal";
import { isAdmin } from "@/app/lib/auth-client";

export const metadata: Metadata = { title: "Accueil" };

// Server Component : la session et les statistiques sont lues côté serveur, sans JavaScript client.
export default async function DashboardPage() {
  const session = await verifySession();
  const { user } = session;

  // Appel RPC typé vers l'API, au nom de l'utilisateur (cookie relayé).
  const res = await api.reading.progress.$get({}, { headers: await getForwardedAuthHeaders() });
  const library = res.ok ? (await res.json()).data : [];
  const reading = library.filter((entry) => entry.status === "reading").length;
  const completed = library.filter((entry) => entry.status === "completed").length;

  const memberSince = new Date(user.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <>
      <section className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bonjour {user.name} 👋</h1>
        <p className="text-muted-foreground">
          Connecté en tant que {user.email}
          {isAdmin(user.role) ? " · Administrateur" : ""} · membre depuis {memberSince}.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Séries suivies", value: library.length },
          { label: "En cours de lecture", value: reading },
          { label: "Terminées", value: completed },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      {library.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Votre bibliothèque est vide</CardTitle>
            <CardDescription>Parcourez le catalogue pour commencer à suivre vos séries.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/catalogue">Explorer le catalogue</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
