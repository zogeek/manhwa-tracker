import type { Metadata } from "next";
import { BookOpen } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddToLibraryButton } from "@/components/manhwa/add-to-library-button";
import { ManhwaCard } from "@/components/manhwa/manhwa-card";
import { api } from "@/app/lib/api";
import { getForwardedAuthHeaders, verifySession } from "@/app/lib/dal";

export const metadata: Metadata = { title: "Catalogue" };

// Server Component : catalogue et bibliothèque sont lus côté serveur (en parallèle), puis seul
// le bouton « Ajouter » est hydraté côté client.
export default async function CataloguePage() {
  await verifySession();
  const authHeaders = await getForwardedAuthHeaders();

  const [catalogRes, libraryRes] = await Promise.all([
    api.manhwas.$get(),
    api.reading.progress.$get({}, { headers: authHeaders }),
  ]);
  if (!catalogRes.ok) throw new Error(`Catalogue indisponible (HTTP ${catalogRes.status})`);

  const { data: manhwas } = await catalogRes.json();
  // Bibliothèque indisponible : on affiche quand même le catalogue (les boutons restent utilisables).
  const library = libraryRes.ok ? (await libraryRes.json()).data : [];
  const followedIds = new Set(library.map((entry) => entry.manhwaId));

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-muted-foreground">
          {manhwas.length} série{manhwas.length > 1 ? "s" : ""} disponible{manhwas.length > 1 ? "s" : ""}.
        </p>
      </header>

      {manhwas.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4" aria-hidden />
              Le catalogue est vide
            </CardTitle>
            <CardDescription>Les séries apparaîtront ici dès leur import par le scraper.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {manhwas.map((manhwa) => (
            <ManhwaCard key={manhwa.id} manhwa={manhwa}>
              <AddToLibraryButton manhwaId={manhwa.id} inLibrary={followedIds.has(manhwa.id)} />
            </ManhwaCard>
          ))}
        </section>
      )}
    </>
  );
}
