import { BookCheck, ListOrdered } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatChapter, formatDate } from "@/app/lib/format";
import { getChapters, getProgress } from "@/app/lib/queries";
import { MarkReadButton } from "./mark-read-button";

/** Liste des chapitres connus (du plus récent au plus ancien), avec l'état « lu » de l'utilisateur. */
export async function ChapterList({ manhwaId }: { manhwaId: string }) {
  // `getProgress` est mémoïsé : le panneau de lecture de la même page ne refait pas l'appel.
  const [chapters, progress] = await Promise.all([getChapters(manhwaId), getProgress(manhwaId)]);
  const readUpTo = progress?.currentChapter ?? 0;
  const newestFirst = chapters.toReversed();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="size-4" aria-hidden />
          Chapitres
          {chapters.length > 0 && <Badge variant="secondary">{chapters.length}</Badge>}
        </CardTitle>
        {chapters.length === 0 && (
          <CardDescription>
            Aucun chapitre connu pour l&apos;instant. Ils sont synchronisés automatiquement en arrière-plan après un
            import depuis MangaDex, ou par le scraper.
          </CardDescription>
        )}
      </CardHeader>
      {chapters.length > 0 && (
        <CardContent>
          <ol className="max-h-[32rem] divide-y overflow-y-auto rounded-md border">
            {newestFirst.map((chapter) => {
              const read = chapter.number <= readUpTo;
              return (
                <li key={chapter.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={read ? "text-muted-foreground" : "font-medium"}>
                    Chapitre {formatChapter(chapter.number)}
                  </span>
                  {chapter.title && <span className="text-muted-foreground min-w-0 truncate">{chapter.title}</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {chapter.releaseDate && (
                      <time className="text-muted-foreground hidden text-xs sm:inline" dateTime={chapter.releaseDate}>
                        {formatDate(chapter.releaseDate)}
                      </time>
                    )}
                    {read ? (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <BookCheck className="size-3.5" aria-hidden />
                        Lu
                      </span>
                    ) : (
                      <MarkReadButton chapterId={chapter.id} number={chapter.number} />
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

export function ChapterListSkeleton() {
  return (
    <Card role="status" aria-label="Chargement des chapitres…">
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
