import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LibraryEntryControls } from "@/components/library/library-entry-controls";
import { ManhwaCard } from "@/components/manhwa/manhwa-card";
import { api } from "@/app/lib/api";
import { getForwardedAuthHeaders, verifySession } from "@/app/lib/dal";
import { READING_STATUS_LABELS, READING_STATUSES } from "@/app/lib/labels";

export const metadata: Metadata = { title: "Ma Bibliothèque" };

// Server Component : la bibliothèque est lue au nom de l'utilisateur (cookie relayé à l'API).
// Chaque carte embarque ses contrôles client ; après une mutation, `router.refresh()` rejoue ce rendu.
export default async function LibraryPage() {
  await verifySession();

  const res = await api.reading.progress.$get({}, { headers: await getForwardedAuthHeaders() });
  if (!res.ok) throw new Error(`Bibliothèque indisponible (HTTP ${res.status})`);
  const { data: library } = await res.json();

  // Regroupement par statut, dans l'ordre d'affichage (les groupes vides sont masqués).
  const groups = READING_STATUSES.map((status) => ({
    status,
    entries: library.filter((entry) => entry.status === status),
  })).filter((group) => group.entries.length > 0);

  return (
    <>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ma Bibliothèque</h1>
        <p className="text-muted-foreground">
          {library.length} série{library.length > 1 ? "s" : ""} suivie{library.length > 1 ? "s" : ""}.
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
        groups.map(({ status, entries }) => (
          <section key={status} className="space-y-3" aria-labelledby={`library-${status}`}>
            <h2 id={`library-${status}`} className="flex items-center gap-2 text-lg font-semibold">
              {READING_STATUS_LABELS[status]}
              <Badge variant="secondary">{entries.length}</Badge>
            </h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {entries.map((entry) => (
                <ManhwaCard key={entry.id} manhwa={entry.manhwa}>
                  <LibraryEntryControls entry={entry} />
                </ManhwaCard>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
