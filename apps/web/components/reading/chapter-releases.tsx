import { ExternalLink } from "lucide-react";
import type { ChapterRelease } from "@/app/lib/api-types";
import { formatLanguage, formatTeams, releaseCredits } from "@/app/lib/releases";

/**
 * Crédits des parutions d'un chapitre : « FR — Asura Scans & Flame Comics ».
 * Parution sans team créditée : la langue seule (affichage neutre). Aucune parution : rien.
 */
export function ChapterReleases({ releases }: { releases: readonly ChapterRelease[] }) {
  const credits = releaseCredits(releases);
  if (credits.length === 0) return null;

  return (
    <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs" aria-label="Parutions">
      {credits.map((credit) => {
        const teams = formatTeams(credit.teams);
        const content = (
          <>
            <abbr title={`Langue : ${credit.language}`} className="font-medium no-underline">
              {formatLanguage(credit.language)}
            </abbr>
            {teams ? <span className="truncate">— {teams}</span> : null}
          </>
        );
        return (
          <li key={credit.key} className="flex min-w-0 items-center gap-1">
            {credit.href ? (
              <a
                href={credit.href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Lire sur ${credit.sourceName}`}
                className="hover:text-foreground flex min-w-0 items-center gap-1 underline-offset-2 hover:underline"
              >
                {content}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
              </a>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ul>
  );
}
