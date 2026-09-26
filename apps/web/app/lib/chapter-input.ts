// Saisie libre d'un numéro de chapitre (champ texte) : le serveur valide aussi (Zod), mais on
// refuse côté client ce qu'il refuserait, pour répondre instantanément et sans requête inutile.

/** Plafond de la colonne `numeric(8,2)` côté base. */
export const MAX_CHAPTER = 999_999.99;

export type ChapterInputResult = { ok: true; value: number } | { ok: false; error: string };

/** « 120 », « 10,5 », « 10.5 », « 1 200 » → nombre ; tout le reste → message d'erreur en français. */
export function parseChapterInput(raw: string): ChapterInputResult {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (text === "") return { ok: false, error: "Indiquez un numéro de chapitre." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: "Numéro invalide : un nombre positif, 2 décimales au plus (ex. 120 ou 10,5)." };
  }
  const value = Number(text);
  if (value > MAX_CHAPTER) return { ok: false, error: "Numéro de chapitre trop grand." };
  return { ok: true, value };
}

/** Valeur affichée dans le champ : « 10,5 », sans séparateur de milliers (qu'on relirait mal). */
export const formatChapterInput = (chapter: number) =>
  chapter.toLocaleString("fr-FR", { maximumFractionDigits: 2, useGrouping: false });
