import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { CatalogManhwa, ManhwaAuthor } from "@/app/lib/api-types";
import { coverSources } from "@/app/lib/cover";
import { MANHWA_TYPE_LABELS, PUBLICATION_STATUS_LABELS } from "@/app/lib/labels";
import { AuthorLine } from "./author-list";
import { CoverImage } from "./cover-image";

type ManhwaCardProps = {
  manhwa: Pick<CatalogManhwa, "title" | "coverUrl" | "type" | "status" | "totalChapters"> & {
    /** Copie locale de la couverture (fiches du catalogue) ; absente pour un résultat externe. */
    localCoverUrl?: string | null;
    authors?: readonly ManhwaAuthor[];
  };
  /** Lien vers la fiche détaillée (couverture et titre deviennent cliquables). */
  href?: string;
  /** Étiquette en haut à droite de la couverture (ex. fournisseur d'un résultat externe). */
  label?: string;
  /** Zone d'actions en pied de carte (boutons client, progression…). */
  children?: React.ReactNode;
};

/** Enveloppe `children` dans un lien quand la carte en a un. */
function MaybeLink({ href, className, children }: { href?: string; className?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

// Composant de présentation pur (sans état) : utilisable depuis un Server Component
// comme depuis un Client Component. L'interactivité est injectée via `children`.
export function ManhwaCard({ manhwa, href, label, children }: ManhwaCardProps) {
  return (
    // `min-w-0` : une cellule de grille ne s'élargit pas au-delà de sa colonne à cause de son contenu.
    <Card className="group min-w-0 gap-3 pt-0">
      <MaybeLink href={href} className="bg-muted relative block aspect-[2/3] overflow-hidden">
        <CoverImage
          sources={coverSources(manhwa)}
          alt={`Couverture de ${manhwa.title}`}
          sizes="(min-width: 1280px) 20vw, (min-width: 768px) 25vw, 50vw"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <Badge className="absolute top-2 left-2 shadow-sm">{MANHWA_TYPE_LABELS[manhwa.type]}</Badge>
        {label && (
          <Badge variant="secondary" className="absolute top-2 right-2 shadow-sm">
            {label}
          </Badge>
        )}
      </MaybeLink>

      <CardHeader className="gap-1">
        <CardTitle className="line-clamp-2 leading-snug" title={manhwa.title}>
          <MaybeLink href={href} className="hover:underline">
            {manhwa.title}
          </MaybeLink>
        </CardTitle>
        <AuthorLine authors={manhwa.authors ?? []} />
      </CardHeader>

      <CardContent className="flex flex-wrap gap-1.5">
        <Badge variant="secondary">{PUBLICATION_STATUS_LABELS[manhwa.status]}</Badge>
        {manhwa.totalChapters !== null && <Badge variant="outline">{manhwa.totalChapters} ch.</Badge>}
      </CardContent>

      {children && <CardFooter className="mt-auto flex-col items-stretch gap-2">{children}</CardFooter>}
    </Card>
  );
}
