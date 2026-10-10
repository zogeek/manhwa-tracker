import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SeriesTracking, TrackedSeries } from "@/app/lib/api-types";
import { TrackedSeriesTable } from "./tracked-series-table";

const now = new Date("2026-10-10T12:00:00Z");

const series = (title: string, tracking: Partial<SeriesTracking>, furthestChapter = 120): TrackedSeries => ({
  id: `progress-${title}`,
  userId: "reader",
  manhwaId: `manhwa-${title}`,
  status: "reading",
  currentChapter: furthestChapter,
  furthestChapter,
  rating: null,
  notes: null,
  startedAt: null,
  completedAt: null,
  updatedAt: now.toISOString(),
  updatedBy: "reader",
  manhwa: {
    id: `manhwa-${title}`,
    title,
    originalTitle: null,
    synopsis: null,
    coverUrl: null,
    type: "manhwa",
    status: "ongoing",
    country: "KR",
    totalChapters: null,
    rating: null,
    startDate: null,
    endDate: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    authors: [],
    localCoverUrl: null,
  },
  tracking: { latestChapter: null, lastScrapedAt: null, sourceStatus: null, sourceCount: 0, ...tracking },
});

const rowOf = (title: string) => {
  const row = screen.getByRole("link", { name: new RegExp(title) }).closest("tr");
  if (!row) throw new Error(`Ligne introuvable : ${title}`);
  return within(row);
};

describe("TrackedSeriesTable", () => {
  it("shows title, latest chapter, source health and last scrape for each series", () => {
    render(
      <TrackedSeriesTable
        now={now}
        series={[
          series("Solo Leveling", { latestChapter: 180.5, lastScrapedAt: "2026-10-10T09:00:00Z", sourceStatus: "up", sourceCount: 2 }),
        ]}
      />,
    );

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Série",
      "Dernier chapitre",
      "Source",
      "Dernier scraping",
    ]);
    const row = rowOf("Solo Leveling");
    expect(row.getByRole("link")).toHaveAttribute("href", "/manhwas/manhwa-Solo Leveling");
    expect(row.getByText("Ch. 180,5")).toBeInTheDocument();
    expect(row.getByText("Nouveau")).toBeInTheDocument();
    expect(row.getByText("Opérationnelle")).toBeInTheDocument();
    expect(row.getByText("2 sources")).toBeInTheDocument();
    expect(row.getByText("il y a 3 heures")).toHaveAttribute("dateTime", "2026-10-10T09:00:00Z");
  });

  it("does not flag a series the reader is up to date with", () => {
    render(<TrackedSeriesTable now={now} series={[series("Omniscient Reader", { latestChapter: 120 }, 120)]} />);

    expect(rowOf("Omniscient Reader").queryByText("Nouveau")).not.toBeInTheDocument();
  });

  it("explains missing tracking data instead of showing empty cells", () => {
    render(
      <TrackedSeriesTable
        now={now}
        series={[series("Sans source", {}), series("Jamais vérifiée", { latestChapter: 3, sourceCount: 1 })]}
      />,
    );

    const orphan = rowOf("Sans source");
    expect(orphan.getByText("Inconnu")).toBeInTheDocument();
    expect(orphan.getByText("Aucune source")).toBeInTheDocument();
    expect(orphan.getByText("Jamais")).toBeInTheDocument();
    expect(rowOf("Jamais vérifiée").getAllByText("Jamais vérifiée")).toHaveLength(2); // titre + badge
  });
});
