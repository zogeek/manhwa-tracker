import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getManhwaTags } from "@/app/lib/queries";

const VOCABULARY_LABELS: Partial<Record<string, string>> = { genre: "Genres", theme: "Thèmes" };

/** Genres et thèmes de l'œuvre (taxonomie), les tags « spoiler » repliés par défaut. */
export async function ManhwaTags({ manhwaId }: { manhwaId: string }) {
  const tags = await getManhwaTags(manhwaId);
  if (tags.length === 0) return null;

  // Regroupement par vocabulaire, genres puis thèmes puis les autres (ordre de l'API).
  const groups = new Map<string, typeof tags>();
  for (const tag of tags) groups.set(tag.vocabularySlug, [...(groups.get(tag.vocabularySlug) ?? []), tag]);
  const ordered = [...groups].sort(([a], [b]) => rank(a) - rank(b));

  return (
    <section className="space-y-3" aria-label="Genres et thèmes">
      {ordered.map(([vocabulary, entries]) => {
        const visible = entries.filter((tag) => !tag.isSpoiler);
        const spoilers = entries.filter((tag) => tag.isSpoiler);
        return (
          <div key={vocabulary} className="space-y-1.5">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {VOCABULARY_LABELS[vocabulary] ?? vocabulary}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {visible.map((tag) => (
                <Badge key={tag.termId} variant={vocabulary === "genre" ? "default" : "outline"}>
                  {tag.term.name}
                </Badge>
              ))}
            </div>
            {spoilers.length > 0 && (
              <details className="text-sm">
                <summary className="text-muted-foreground cursor-pointer">
                  Afficher {spoilers.length} tag{spoilers.length > 1 ? "s" : ""} spoiler
                </summary>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {spoilers.map((tag) => (
                    <Badge key={tag.termId} variant="destructive">
                      {tag.term.name}
                    </Badge>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

const rank = (vocabulary: string) => (vocabulary === "genre" ? 0 : vocabulary === "theme" ? 1 : 2);

export function ManhwaTagsSkeleton() {
  return (
    <div role="status" aria-label="Chargement des tags…" className="flex flex-wrap gap-1.5">
      {[16, 20, 14, 24, 18].map((width, index) => (
        <Skeleton key={index} className="h-5 rounded-full" style={{ width: `${width * 4}px` }} />
      ))}
    </div>
  );
}
