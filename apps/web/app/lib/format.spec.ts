import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format";

const now = new Date("2026-10-10T12:00:00Z");

describe("formatRelativeTime", () => {
  it.each([
    ["2026-10-10T11:59:30Z", "à l'instant"],
    ["2026-10-10T11:55:00Z", "il y a 5 minutes"],
    ["2026-10-10T09:00:00Z", "il y a 3 heures"],
    ["2026-10-09T12:00:00Z", "hier"],
    ["2026-09-26T12:00:00Z", "il y a 2 semaines"],
    ["2025-10-10T12:00:00Z", "l’année dernière"],
  ])("formats %s as « %s »", (value, expected) => {
    expect(formatRelativeTime(value, now)).toBe(expected);
  });
});
