/** Numéro de chapitre à la française : 12, 10,5. */
export const formatChapter = (chapter: number) => chapter.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** Date ISO (`2018-07-17` ou horodatage) → « 17 juillet 2018 ». */
export const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
