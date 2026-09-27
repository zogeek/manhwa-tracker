import type { ChapterRelease, ReleaseTeam } from "./api-types";

/** Crédits d'une parution : « Asura Scans », « Asura Scans & Flame Comics », « A, B & C ». */
export function formatTeams(teams: readonly Pick<ReleaseTeam, "name">[]): string {
  const names = teams.map((team) => team.name);
  const last = names.pop();
  if (last === undefined) return "";
  return names.length === 0 ? last : `${names.join(", ")} & ${last}`;
}

/** Code langue de la source (`fr`, `pt-br`) → étiquette courte (`FR`, `PT-BR`). */
export const formatLanguage = (language: string) => language.toUpperCase();

/**
 * Lien sortant vers une parution : uniquement en http(s). Les URLs viennent de sources tierces
 * (scraper, catalogues) : un `javascript:` injecté ne doit jamais devenir un lien cliquable.
 */
export function externalHref(url: string): string | null {
  const parsed = URL.parse(url);
  return parsed?.protocol === "https:" || parsed?.protocol === "http:" ? parsed.href : null;
}

export type ReleaseCredit = {
  key: string;
  language: string;
  teams: ChapterRelease["teams"];
  /** Première parution lisible de ce crédit (les autres sources publient la même traduction). */
  href: string | null;
  sourceName: string;
};

/**
 * Une ligne par couple « langue + teams » : la même traduction republiée sur plusieurs sources
 * (MangaDex et un site scrapé) n'est affichée qu'une fois. L'ordre de l'API est conservé.
 */
export function releaseCredits(releases: readonly ChapterRelease[]): ReleaseCredit[] {
  const credits = new Map<string, ReleaseCredit>();
  for (const release of releases) {
    const key = `${release.language}|${release.teams.map((team) => team.id).join(",")}`;
    const href = externalHref(release.url);
    const existing = credits.get(key);
    if (!existing) {
      credits.set(key, { key, language: release.language, teams: release.teams, href, sourceName: release.sourceName });
    } else if (!existing.href && href) {
      existing.href = href;
      existing.sourceName = release.sourceName;
    }
  }
  return [...credits.values()];
}
