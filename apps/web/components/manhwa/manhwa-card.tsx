import Image from "next/image";
import { ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { CatalogManhwa } from "@/app/lib/api-types";
import { MANHWA_TYPE_LABELS, PUBLICATION_STATUS_LABELS } from "@/app/lib/labels";

type ManhwaCardProps = {
  manhwa: Pick<CatalogManhwa, "title" | "coverUrl" | "type" | "status" | "totalChapters">;
  /** Zone d'actions en pied de carte (boutons client, progression…). */
  children?: React.ReactNode;
};

// Composant de présentation pur (sans état) : utilisable depuis un Server Component
// comme depuis un Client Component. L'interactivité est injectée via `children`.
export function ManhwaCard({ manhwa, children }: ManhwaCardProps) {
  return (
    <Card className="group gap-3 pt-0">
      <div className="bg-muted relative aspect-[2/3] overflow-hidden">
        {manhwa.coverUrl ? (
          // `unoptimized` : les couvertures viennent de domaines tiers variés (sources scrapées),
          // qu'on ne peut pas lister dans `images.remotePatterns`.
          <Image
            src={manhwa.coverUrl}
            alt={`Couverture de ${manhwa.title}`}
            fill
            unoptimized
            sizes="(min-width: 1280px) 20vw, (min-width: 768px) 25vw, 50vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-2">
            <ImageOff className="size-8" aria-hidden />
            <span className="text-xs">Pas de couverture</span>
          </div>
        )}
        <Badge className="absolute top-2 left-2 shadow-sm">{MANHWA_TYPE_LABELS[manhwa.type]}</Badge>
      </div>

      <CardHeader className="gap-2">
        <CardTitle className="line-clamp-2 leading-snug" title={manhwa.title}>
          {manhwa.title}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{PUBLICATION_STATUS_LABELS[manhwa.status]}</Badge>
        {manhwa.totalChapters !== null && <Badge variant="outline">{manhwa.totalChapters} ch.</Badge>}
      </CardContent>

      {children && <CardFooter className="mt-auto flex-col items-stretch gap-2">{children}</CardFooter>}
    </Card>
  );
}
