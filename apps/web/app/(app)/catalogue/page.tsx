import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/app/lib/api";
import { verifySession } from "@/app/lib/dal";

export const metadata: Metadata = { title: "Catalogue" };

// Server Component : le catalogue est public côté API, récupéré au rendu serveur.
export default async function CataloguePage() {
  await verifySession();
  const res = await api.manhwas.$get();
  if (!res.ok) throw new Error(`Catalogue indisponible (HTTP ${res.status})`);
  const { data: manhwas } = await res.json();

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
      {manhwas.length === 0 ? (
        <p className="text-muted-foreground">Le catalogue est vide pour le moment.</p>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {manhwas.map((manhwa) => (
            <Card key={manhwa.id}>
              <CardHeader>
                <CardTitle className="line-clamp-2">{manhwa.title}</CardTitle>
                <CardDescription>
                  {manhwa.type} · {manhwa.totalChapters ?? "?"} chapitres
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
    </>
  );
}
