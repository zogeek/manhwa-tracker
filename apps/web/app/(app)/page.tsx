import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AddSeriesDialog } from "@/components/dashboard/add-series-dialog";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { TrackedSeriesTable } from "@/components/dashboard/tracked-series-table";
import { verifySession } from "@/app/lib/dal";
import { isAdmin } from "@/app/lib/auth-client";
import { getDashboard } from "@/app/lib/queries";
import { ROUTES } from "@/app/lib/routes";
import { hasUnreadChapters } from "@/app/lib/tracking";

export const metadata: Metadata = { title: "Tableau de bord" };

// Server Component : la session est vérifiée côté serveur ; l'en-tête s'affiche tout de suite et
// le tableau arrive en streaming (squelette en attendant), sans JavaScript client pour la lecture.
export default async function DashboardPage() {
  const { user } = await verifySession();
  const memberSince = new Date(user.createdAt).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bonjour {user.name} 👋</h1>
          <p className="text-muted-foreground">
            Connecté en tant que {user.email}
            {isAdmin(user.role) ? " · Administrateur" : ""} · membre depuis {memberSince}.
          </p>
        </div>
        <AddSeriesDialog />
      </section>

      <Suspense fallback={<DashboardSkeleton />}>
        <TrackedSeriesSection />
      </Suspense>
    </>
  );
}

/** Statistiques + tableau des séries suivies (une seule requête `GET /reading/dashboard`). */
async function TrackedSeriesSection() {
  const series = await getDashboard();
  const stats = [
    { label: "Séries suivies", value: series.length },
    { label: "En cours de lecture", value: series.filter((entry) => entry.status === "reading").length },
    { label: "Avec des chapitres à lire", value: series.filter(hasUnreadChapters).length },
  ];

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      {series.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Vous ne suivez encore aucune série</CardTitle>
            <CardDescription>
              Ajoutez-en une avec son lien AniList, MangaDex ou Kitsu, ou parcourez le catalogue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={ROUTES.catalog}>Explorer le catalogue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Séries suivies</CardTitle>
            <CardDescription>Dernières parutions repérées par le scraper sur vos sources.</CardDescription>
          </CardHeader>
          <CardContent>
            <TrackedSeriesTable series={series} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
