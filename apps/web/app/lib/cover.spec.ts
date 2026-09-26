import { describe, expect, it } from "vitest";
import { coverSrc } from "./cover";

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
