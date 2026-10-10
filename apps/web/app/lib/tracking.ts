import type { TrackedSeries } from "./api-types";

/** Des chapitres sont « à lire » quand le dernier chapitre connu dépasse le plus loin lu. */
export const hasUnreadChapters = ({ furthestChapter, tracking }: Pick<TrackedSeries, "furthestChapter" | "tracking">) =>
  tracking.latestChapter !== null && tracking.latestChapter > furthestChapter;
