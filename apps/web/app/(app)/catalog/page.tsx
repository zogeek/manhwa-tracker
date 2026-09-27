import type { Metadata } from "next";
import { Suspense } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddToLibraryButton } from "@/components/manhwa/add-to-library-button";
import { ManhwaCard } from "@/components/manhwa/manhwa-card";
import { ManhwaGrid, ManhwaGridSkeleton } from "@/components/manhwa/manhwa-grid";
import { CatalogSearch } from "@/components/search/catalog-search";
import { SearchResults } from "@/components/search/search-results";
import { api } from "@/app/lib/api";
import { verifySession } from "@/app/lib/dal";
import { getLibraryIds } from "@/app/lib/queries";
import { MIN_QUERY_LENGTH } from "@/app/lib/search";
import { ROUTES } from "@/app/lib/routes";

export const metadata: Metadata = { title: "Catalogue" };

type CataloguePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// Server Component : la recherche vit dans l'URL (`?q=…&external=true`). La page la relit,
// affiche immédiatement l'en-tête et la barre, puis « streame » les résultats via <Suspense>.
export default async function CataloguePage({ searchParams }: CataloguePageProps) {
  await verifySession();
  const params = await searchParams;
  const q = typeof params["q"] === "string" ? params["q"].trim() : "";
  const external = params["external"] === "true";
  const searching = q.length >= MIN_QUERY_LENGTH;

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Catalogue</h1>
        <p className="text-muted-foreground">
          Retrouvez une série de notre catalogue, ou importez-la depuis AniList, MangaDex ou Kitsu.
        </p>
      </header>

      <CatalogSearch />

      {searching ? (
        // `key` : une nouvelle recherche remonte la frontière Suspense → le squelette réapparaît.
        <Suspense key={`${q}|${external}`} fallback={<ManhwaGridSkeleton />}>
          <SearchResults q={q} external={external} />
        </Suspense>
      ) : (
        <Suspense fallback={<ManhwaGridSkeleton />}>
          <CatalogGrid />
        </Suspense>
      )}
    </>
  );
}

/** Tout le catalogue local (affiché quand aucune recherche n'est en cours). */
async function CatalogGrid() {
  const [catalogRes, libraryIds] = await Promise.all([api.manhwas.$get(), getLibraryIds()]);
  if (!catalogRes.ok) throw new Error(`Catalogue indisponible (HTTP ${catalogRes.status})`);
  const { data: manhwas } = await catalogRes.json();

  if (manhwas.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden />
            Le catalogue est vide
          </CardTitle>
          <CardDescription>Lancez une recherche ci-dessus pour importer vos premières séries.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="catalog-all">
      <h2 id="catalog-all" className="text-lg font-semibold">
        Toutes les séries <span className="text-muted-foreground font-normal">({manhwas.length})</span>
      </h2>
      <ManhwaGrid>
        {manhwas.map((manhwa) => (
          <ManhwaCard key={manhwa.id} manhwa={manhwa} href={ROUTES.manhwa(manhwa.id)}>
            <AddToLibraryButton manhwaId={manhwa.id} inLibrary={libraryIds.has(manhwa.id)} />
          </ManhwaCard>
        ))}
      </ManhwaGrid>
    </section>
  );
}
