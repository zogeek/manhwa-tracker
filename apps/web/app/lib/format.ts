/** Numéro de chapitre à la française : 12, 10,5. */
export const formatChapter = (chapter: number) => chapter.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Date ISO (`2018-07-17` ou horodatage) → « 17 juillet 2018 ». */
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

const RELATIVE_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relativeFormat = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

/** Horodatage → « il y a 3 heures », « hier »… (`now` injectable pour les tests). */
export function formatRelativeTime(value: string, now: Date = new Date()): string {
  const seconds = (new Date(value).getTime() - now.getTime()) / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return "à l'instant";
}

/** Horodatage → « 10 octobre 2026 à 14:32 » (heure de Paris), pour les infobulles. */
export const formatDateTime = (value: string) =>
  new Date(value).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" });
