import { describe, expect, it } from "vitest";
import { getApiInternalUrl } from "./env";

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
