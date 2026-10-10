import { describe, expect, it } from "vitest";
import { getApiInternalUrl, getDistDir } from "./env";

describe("getApiInternalUrl", () => {
  it("retombe sur l'API locale quand la variable est absente ou vide", () => {
    expect(getApiInternalUrl(undefined)).toBe("http://localhost:3001");
    expect(getApiInternalUrl("  ")).toBe("http://localhost:3001");
  });

  it("retire les / finaux pour que `${url}/api/auth` reste un chemin propre", () => {
    expect(getApiInternalUrl("http://api:3001//")).toBe("http://api:3001");
  });

  it("refuse une valeur qui n'est pas une URL http(s)", () => {
    expect(() => getApiInternalUrl("api:3001")).toThrow(/API_INTERNAL_URL invalide/);
    expect(() => getApiInternalUrl("localhost")).toThrow(/API_INTERNAL_URL invalide/);
  });
});

describe("getDistDir", () => {
  it("garde le dossier .next par défaut", () => {
    expect(getDistDir(undefined)).toBe(".next");
    expect(getDistDir("  ")).toBe(".next");
  });

  it("accepte un dossier dédié (build des tests E2E)", () => {
    expect(getDistDir(".next-e2e")).toBe(".next-e2e");
  });

  it("refuse un chemin qui sortirait de l'application", () => {
    expect(() => getDistDir("../dist")).toThrow(/NEXT_DIST_DIR invalide/);
    expect(() => getDistDir("/tmp/build")).toThrow(/NEXT_DIST_DIR invalide/);
  });
});
