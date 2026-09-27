import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AuthorCredits } from "@/components/manhwa/author-list";
import { CoverImage } from "@/components/manhwa/cover-image";
import { ManhwaTags, ManhwaTagsSkeleton } from "@/components/manhwa/manhwa-tags";
import { ChapterList, ChapterListSkeleton } from "@/components/reading/chapter-list";
import { ReadingPanel, ReadingPanelSkeleton } from "@/components/reading/reading-panel";
import { coverSources } from "@/app/lib/cover";
import { verifySession } from "@/app/lib/dal";
import { formatDate } from "@/app/lib/format";
import { MANHWA_TYPE_LABELS, PUBLICATION_STATUS_LABELS } from "@/app/lib/labels";
import { getManhwa } from "@/app/lib/queries";
import { ROUTES } from "@/app/lib/routes";

type ManhwaPageProps = { params: Promise<{ id: string }> };

// `getManhwa` est mémoïsé : le titre de l'onglet et la page partagent un seul appel à l'API.
export async function generateMetadata({ params }: ManhwaPageProps): Promise<Metadata> {
  const manhwa = await getManhwa((await params).id);
  return { title: manhwa?.title ?? "Série introuvable" };
}

// Server Component : la fiche est lue avant le premier octet (titre, couverture, synopsis),
// puis la progression, les tags et les chapitres sont streamés chacun dans leur <Suspense>.
export default async function ManhwaPage({ params }: ManhwaPageProps) {
  await verifySession();
  const { id } = await params;
  const manhwa = await getManhwa(id);
  if (!manhwa) notFound();

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link href={ROUTES.catalog}>
          <ArrowLeft data-icon="inline-start" />
          Catalogue
        </Link>
      </Button>

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <div className="bg-muted relative aspect-[2/3] overflow-hidden rounded-xl border">
            <CoverImage
              sources={coverSources(manhwa)}
              alt={`Couverture de ${manhwa.title}`}
              priority
              sizes="(min-width: 1024px) 280px, 100vw"
              className="object-cover"
            />
          </div>
          <Suspense fallback={<ReadingPanelSkeleton />}>
            <ReadingPanel manhwa={manhwa} />
          </Suspense>
        </aside>

        <article className="flex min-w-0 flex-col gap-6">
          <header className="space-y-3">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">{manhwa.title}</h1>
              {manhwa.originalTitle && (
                <p className="text-muted-foreground text-lg" lang="und">
                  {manhwa.originalTitle}
                </p>
              )}
            </div>
            <AuthorCredits authors={manhwa.authors} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{MANHWA_TYPE_LABELS[manhwa.type]}</Badge>
              <Badge variant="secondary">{PUBLICATION_STATUS_LABELS[manhwa.status]}</Badge>
              {manhwa.totalChapters !== null && <Badge variant="outline">{manhwa.totalChapters} chapitres</Badge>}
              {manhwa.rating !== null && (
                <Badge variant="outline" aria-label={`Note moyenne ${manhwa.rating} sur 10`}>
                  <Star className="fill-amber-400 text-amber-400" aria-hidden />
                  {manhwa.rating.toLocaleString("fr-FR")} / 10
                </Badge>
              )}
              {manhwa.startDate && (
                <span className="text-muted-foreground flex items-center gap-1 text-sm">
                  <CalendarDays className="size-4" aria-hidden />
                  Depuis le {formatDate(manhwa.startDate)}
                  {manhwa.endDate && ` · jusqu'au ${formatDate(manhwa.endDate)}`}
                </span>
              )}
            </div>
          </header>

          <section aria-labelledby="synopsis" className="space-y-2">
            <h2 id="synopsis" className="text-lg font-semibold">
              Synopsis
            </h2>
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {manhwa.synopsis ?? "Aucun synopsis pour le moment."}
            </p>
          </section>

          <Suspense fallback={<ManhwaTagsSkeleton />}>
            <ManhwaTags manhwaId={manhwa.id} />
          </Suspense>

          <Suspense fallback={<ChapterListSkeleton />}>
            <ChapterList manhwaId={manhwa.id} />
          </Suspense>
        </article>
      </div>
    </>
  );
}
