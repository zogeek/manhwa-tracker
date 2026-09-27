import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LibraryEntryControls } from "@/components/library/library-entry-controls";
import { LibraryTabs } from "@/components/library/library-tabs";
import { ManhwaCard } from "@/components/manhwa/manhwa-card";
import { api } from "@/app/lib/api";
import { getForwardedAuthHeaders, verifySession } from "@/app/lib/dal";
import { READING_STATUSES } from "@/app/lib/labels";
import { ALL_TAB, type LibraryTab } from "@/app/lib/library";

export const metadata: Metadata = { title: "Ma Bibliothèque" };

type LibraryPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

// Server Component : la bibliothèque est lue au nom de l'utilisateur (cookie relayé à l'API) et
// chaque carte est rendue ici ; les onglets (client) ne font que choisir lesquelles afficher.
// Après une mutation (statut, +1), `router.refresh()` rejoue ce rendu : la carte change d'onglet.
export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  await verifySession();
  const [res, params] = await Promise.all([
    api.reading.progress.$get({}, { headers: await getForwardedAuthHeaders() }),
    searchParams,
  ]);
  if (!res.ok) throw new Error(`Bibliothèque indisponible (HTTP ${res.status})`);
  const { data: library } = await res.json();

  // `?statut=on_hold` : onglet ouvert au chargement (lien partageable) ; toute autre valeur → « Toutes ».
  const requested = params["statut"];
  const initialTab: LibraryTab = READING_STATUSES.find((status) => status === requested) ?? ALL_TAB;

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ma Bibliothèque</h1>
        <p className="text-muted-foreground">
          {library.length} série{library.length > 1 ? "s" : ""} suivie{library.length > 1 ? "s" : ""}. Changez un
          statut directement depuis une carte ; la saisie du chapitre exact se fait sur la fiche.
        </p>
      </header>

      {library.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Votre bibliothèque est vide</CardTitle>
            <CardDescription>Ajoutez des séries depuis le catalogue pour suivre votre progression.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/catalogue">Explorer le catalogue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <LibraryTabs
          initialTab={initialTab}
          items={library.map((entry) => ({
            key: entry.id,
            status: entry.status,
            card: (
              <ManhwaCard manhwa={entry.manhwa} href={`/manhwas/${entry.manhwaId}`}>
                <LibraryEntryControls entry={entry} />
              </ManhwaCard>
            ),
          }))}
        />
      )}
    </>
  );
}
