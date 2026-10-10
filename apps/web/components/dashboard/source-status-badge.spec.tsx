import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SourceHealthStatus } from "@/app/lib/api-types";
import { SourceStatusBadge } from "./source-status-badge";

describe("SourceStatusBadge", () => {
  it.each<[SourceHealthStatus, string, string]>([
    ["up", "Opérationnelle", "secondary"],
    ["degraded", "Ralentie", "outline"],
    ["blocked", "Bloquée (anti-bot)", "destructive"],
    ["down", "Hors ligne", "destructive"],
  ])("renders the %s status", (sourceStatus, label, variant) => {
    render(<SourceStatusBadge tracking={{ sourceStatus, sourceCount: 1 }} />);

    expect(screen.getByText(label)).toHaveAttribute("data-variant", variant);
  });

  it("distinguishes a series without source from a source never checked", () => {
    const { rerender } = render(<SourceStatusBadge tracking={{ sourceStatus: null, sourceCount: 0 }} />);
    expect(screen.getByText("Aucune source")).toBeInTheDocument();

    rerender(<SourceStatusBadge tracking={{ sourceStatus: null, sourceCount: 2 }} />);
    expect(screen.getByText("Jamais vérifiée")).toBeInTheDocument();
  });
});
