import { describe, expect, it } from "vitest";
import { coverSources, coverSrc } from "./cover";

describe("coverSrc", () => {
  it("routes third-party covers through the API image proxy", () => {
    expect(coverSrc("https://s4.anilist.co/file/cover.jpg?v=2")).toBe(
      "/api/images/proxy?url=https%3A%2F%2Fs4.anilist.co%2Ffile%2Fcover.jpg%3Fv%3D2",
    );
  });

  it("keeps images we already serve and drops what the proxy would refuse", () => {
    expect(coverSrc("/api/images/media/abc.png")).toBe("/api/images/media/abc.png");
    expect(coverSrc(null)).toBeNull();
    expect(coverSrc("http://insecure.example/cover.jpg")).toBeNull();
    expect(coverSrc("not a url")).toBeNull();
  });
});

describe("coverSources", () => {
  it("prefers the local copy (through the Next proxy), then the original cover through the image proxy", () => {
    expect(
      coverSources({ localCoverUrl: "/images/media/abc.png", coverUrl: "https://s4.anilist.co/cover.jpg" }),
    ).toEqual(["/api/images/media/abc.png", "/api/images/proxy?url=https%3A%2F%2Fs4.anilist.co%2Fcover.jpg"]);
  });

  it("falls back to the proxy alone until the mirror job has run, and to nothing without any cover", () => {
    expect(coverSources({ localCoverUrl: null, coverUrl: "https://s4.anilist.co/cover.jpg" })).toHaveLength(1);
    expect(coverSources({ coverUrl: "https://s4.anilist.co/cover.jpg" })).toHaveLength(1);
    expect(coverSources({ localCoverUrl: null, coverUrl: null })).toEqual([]);
  });

  it("ignores a local path that is not one of our media routes", () => {
    expect(coverSources({ localCoverUrl: "//evil.example/x.png", coverUrl: null })).toEqual([]);
  });
});
