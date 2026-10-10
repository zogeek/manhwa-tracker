import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import type { SeriesTracking, SourceHealthStatus } from "@/app/lib/api-types";
import { SOURCE_STATUS_LABELS } from "@/app/lib/labels";

const VARIANTS: Record<SourceHealthStatus, "secondary" | "outline" | "destructive"> = {
  up: "secondary",
  degraded: "outline",
  blocked: "destructive",
  down: "destructive",
};

const DOTS: Record<SourceHealthStatus, string> = {
  up: "bg-emerald-500",
  degraded: "bg-amber-500",
  blocked: "bg-destructive",
  down: "bg-destructive",
};

type SourceStatusBadgeProps = { tracking: Pick<SeriesTracking, "sourceStatus" | "sourceCount"> };

/** État de la meilleure source d'une série (dernière vérification du scraper). */
export function SourceStatusBadge({ tracking: { sourceStatus, sourceCount } }: SourceStatusBadgeProps) {
  if (sourceCount === 0) return <Badge variant="outline">Aucune source</Badge>;
  if (!sourceStatus) return <Badge variant="outline">Jamais vérifiée</Badge>;

  return (
    <Badge variant={VARIANTS[sourceStatus]}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOTS[sourceStatus])} />
      {SOURCE_STATUS_LABELS[sourceStatus]}
    </Badge>
  );
}
