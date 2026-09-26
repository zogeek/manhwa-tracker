import Link from "next/link";
import { ArrowRight, CircleAlert, Globe, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddToLibraryButton } from "@/components/manhwa/add-to-library-button";
import { ManhwaCard } from "@/components/manhwa/manhwa-card";
import { ManhwaGrid } from "@/components/manhwa/manhwa-grid";
import { api } from "@/app/lib/api";
import type { ExternalProvider, ProviderReport } from "@/app/lib/api-types";
import { getLibraryIds } from "@/app/lib/queries";
import { ImportButton } from "./import-button";

export const PROVIDER_LABELS: Record<ExternalProvider, string> = {
  anilist: "AniList",
  mangadex: "MangaDex",
  kitsu: "Kitsu",
};

type ProviderFailure = { provider: ExternalProvider; status: Exclude<ProviderReport["status"], "ok"> };

const STATUS_MESSAGES: Record<ProviderFailure["status"], string> = {
  unavailable: "ne répond pas pour le moment",
  rate_limited: "est très sollicité, réessayez dans une minute",
};

type SearchResultsProps = { q: string; external: boolean };

/**
 * Server Component asynchrone : interroge `GET /manhwas/search` (RPC typé) pendant le rendu.
 * Il est enveloppé dans un <Suspense> par la page : le squelette s'affiche tout de suite,
 * puis ce bloc est « streamé » dès que l'API a répondu.
 */
export async function SearchResults({ q, external }: SearchResultsProps) {
  const [res, libraryIds] = await Promise.all([
    api.manhwas.search.$get({ query: { q, ...(external ? { external: "true" } : {}) } }),
    getLibraryIds(),
  ]);
  if (!res.ok) throw new Error(`Recherche indisponible (HTTP ${res.status})`);
  const { data } = await res.json();

  const failures = data.providers.flatMap(({ provider, status }): ProviderFailure[] =>
    status === "ok" ? [] : [{ provider, status }],
  );
  const externalParams = new URLSearchParams({ q, external: "true" });

  if (data.local.length === 0 && data.external.length === 0) {
    return (
      <>
        <ProviderFailures failures={failures} />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SearchX className="size-4" aria-hidden />
              Aucun résultat pour « {q} »
            </CardTitle>
            <CardDescription>
              Ni notre catalogue ni les catalogues en ligne ne connaissent cette œuvre. Vérifiez l&apos;orthographe ou
              essayez son titre original.
            </CardDescription>
          </CardHeader>
        </Card>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {data.local.length > 0 && (
        <section className="space-y-3" aria-labelledby="results-local">
          <h2 id="results-local" className="text-lg font-semibold">
            Dans le catalogue <span className="text-muted-foreground font-normal">({data.local.length})</span>
          </h2>
          <ManhwaGrid>
            {data.local.map((manhwa) => (
              <ManhwaCard key={manhwa.id} manhwa={manhwa} href={`/manhwas/${manhwa.id}`}>
                <AddToLibraryButton manhwaId={manhwa.id} inLibrary={libraryIds.has(manhwa.id)} />
              </ManhwaCard>
            ))}
          </ManhwaGrid>
          {!external && (
            <Button variant="link" asChild className="px-0">
              <Link href={`/catalogue?${externalParams}`} replace scroll={false}>
                <Globe data-icon="inline-start" />
                Pas ce que vous cherchez ? Chercher aussi sur AniList, MangaDex et Kitsu
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
        </section>
      )}

      {data.providers.length > 0 && (
        <section className="space-y-3" aria-labelledby="results-external">
          <div className="space-y-1">
            <h2 id="results-external" className="text-lg font-semibold">
              Catalogues en ligne <span className="text-muted-foreground font-normal">({data.external.length})</span>
            </h2>
            <p className="text-muted-foreground text-sm">
              Importez une œuvre pour l&apos;ajouter à notre catalogue : sa couverture et ses chapitres suivront
              automatiquement.
            </p>
          </div>
          <ProviderFailures failures={failures} />
          {data.external.length > 0 && (
            <ManhwaGrid>
              {data.external.map((hit) => (
                <ManhwaCard
                  key={`${hit.provider}:${hit.externalId}`}
                  manhwa={hit}
                  label={PROVIDER_LABELS[hit.provider]}
                  href={hit.importedManhwaId ? `/manhwas/${hit.importedManhwaId}` : undefined}
                >
                  {hit.importedManhwaId ? (
                    <Button variant="secondary" asChild>
                      <Link href={`/manhwas/${hit.importedManhwaId}`}>
                        Voir la fiche
                        <ArrowRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  ) : (
                    <ImportButton provider={hit.provider} externalId={hit.externalId} title={hit.title} />
                  )}
                </ManhwaCard>
              ))}
            </ManhwaGrid>
          )}
        </section>
      )}
    </div>
  );
}

/** Dégradation gracieuse : un fournisseur en panne est signalé, les autres résultats restent affichés. */
function ProviderFailures({ failures }: { failures: ProviderFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <ul role="status" className="flex flex-col gap-1">
      {failures.map(({ provider, status }) => (
        <li
          key={provider}
          className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm"
        >
          <CircleAlert className="size-4 shrink-0 text-amber-500" aria-hidden />
          {PROVIDER_LABELS[provider]} {STATUS_MESSAGES[status]}.
        </li>
      ))}
    </ul>
  );
}
