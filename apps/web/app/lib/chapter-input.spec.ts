import { describe, expect, it } from "vitest";
import { formatChapterInput, parseChapterInput } from "./chapter-input";

describe("parseChapterInput", () => {
  it.each([
    ["120", 120],
    ["  42 ", 42],
    ["10,5", 10.5],
    ["10.25", 10.25],
    ["1 200", 1200],
    ["0", 0],
  ])("accepts %j", (raw, value) => {
    expect(parseChapterInput(raw)).toEqual({ ok: true, value });
  });

  it.each(["", "abc", "-3", "1.234", "12a", "1e3", "999999999"])("rejects %j with a message", (raw) => {
    const result = parseChapterInput(raw);
    expect(result.ok).toBe(false);
  });
});

describe("formatChapterInput", () => {
  it("uses a French decimal comma and no thousands separator", () => {
    expect(formatChapterInput(10.5)).toBe("10,5");
    expect(formatChapterInput(1200)).toBe("1200");
    // Aller-retour sans perte : ce que le champ affiche se relit à l'identique.
    expect(parseChapterInput(formatChapterInput(1234.56))).toEqual({ ok: true, value: 1234.56 });
  });
});
