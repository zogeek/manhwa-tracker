import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Grille responsive commune au catalogue, aux résultats de recherche et à la bibliothèque. */
export function ManhwaGrid({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div aria-label={label} className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}

/** Squelette affiché pendant le chargement d'une grille (même gabarit que `ManhwaCard`). */
export function ManhwaGridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div role="status" aria-label="Chargement des séries…">
      <ManhwaGrid>
        {Array.from({ length: count }, (_, index) => (
          <Card key={index} className="gap-3 pt-0">
            <Skeleton className="aspect-[2/3] rounded-none" />
            <CardHeader className="gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
            <CardContent className="flex gap-1.5">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-12" />
            </CardContent>
          </Card>
        ))}
      </ManhwaGrid>
    </div>
  );
}
