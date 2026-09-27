import { formatChapter } from "@/app/lib/format";

type ProgressBarProps = { title: string; currentChapter: number; totalChapters: number | null };

/** « Chapitre 12 / 200 » + barre (si le total est connu). Composant de présentation pur. */
export function ProgressBar({ title, currentChapter, totalChapters }: ProgressBarProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Chapitre</span>
        <span className="font-medium tabular-nums">
          {formatChapter(currentChapter)}
          {totalChapters !== null && <span className="text-muted-foreground"> / {totalChapters}</span>}
        </span>
      </div>
      {totalChapters !== null && totalChapters > 0 && (
        <div
          role="progressbar"
          aria-label={`Progression de lecture de ${title}`}
          aria-valuemin={0}
          aria-valuemax={totalChapters}
          aria-valuenow={Math.min(currentChapter, totalChapters)}
          className="bg-muted h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full rounded-full transition-[width]"
            style={{ width: `${Math.min(100, (currentChapter / totalChapters) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
