import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CoverImage } from "@/components/manhwa/cover-image";
import type { TrackedSeries } from "@/app/lib/api-types";
import { coverSources } from "@/app/lib/cover";
import { formatChapter, formatDateTime, formatRelativeTime } from "@/app/lib/format";
import { READING_STATUS_LABELS } from "@/app/lib/labels";
import { ROUTES } from "@/app/lib/routes";
import { hasUnreadChapters } from "@/app/lib/tracking";
import { SourceStatusBadge } from "./source-status-badge";

type TrackedSeriesTableProps = { series: readonly TrackedSeries[]; now?: Date };

/**
 * Tableau des séries suivies : une ligne par série, des colonnes comparables d'un coup d'œil
 * (dernier chapitre, santé de la source, fraîcheur du scraping). Rendu serveur, sans état.
 */
export function TrackedSeriesTable({ series, now }: TrackedSeriesTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Série</TableHead>
          <TableHead>Dernier chapitre</TableHead>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Dernier scraping</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {series.map((entry) => {
          const { manhwa, tracking } = entry;
          return (
            <TableRow key={entry.manhwaId}>
              <TableCell>
                <Link href={ROUTES.manhwa(manhwa.id)} className="group flex items-center gap-3">
                  <span className="bg-muted relative hidden h-14 w-10 shrink-0 overflow-hidden rounded-sm sm:block">
                    <CoverImage sources={coverSources(manhwa)} alt="" sizes="40px" className="object-cover" placeholderLabel="" />
                  </span>
                  <span className="min-w-0">
                    <span className="block max-w-64 truncate font-medium group-hover:underline">{manhwa.title}</span>
                    <span className="text-muted-foreground text-xs">{READING_STATUS_LABELS[entry.status]}</span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                {tracking.latestChapter === null ? (
                  <span className="text-muted-foreground">Inconnu</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 tabular-nums">
                      Ch. {formatChapter(tracking.latestChapter)}
                      {hasUnreadChapters(entry) && <Badge>Nouveau</Badge>}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      Lu jusqu&apos;au ch. {formatChapter(entry.furthestChapter)}
                    </span>
                  </span>
                )}
              </TableCell>
              <TableCell>
                <span className="flex flex-col items-start gap-1">
                  <SourceStatusBadge tracking={tracking} />
                  {tracking.sourceCount > 1 && (
                    <span className="text-muted-foreground text-xs">{tracking.sourceCount} sources</span>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {tracking.lastScrapedAt ? (
                  <time dateTime={tracking.lastScrapedAt} title={formatDateTime(tracking.lastScrapedAt)}>
                    {formatRelativeTime(tracking.lastScrapedAt, now)}
                  </time>
                ) : (
                  <span className="text-muted-foreground">Jamais</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
