import { describe, expect, it } from "vitest";
import { beamingTitle } from "./beam.shared";

describe("beamingTitle", () => {
  it("falls back to the workspace name when the workspace has no title", () => {
    expect(beamingTitle(null, "cruel-dolphin")).toBe("⚡ cruel-dolphin");
  });

  it("prefixes the existing title when the workspace has one", () => {
    expect(beamingTitle("Checkout rewrite", "cruel-dolphin")).toBe("⚡ Checkout rewrite");
  });

  it("does not prefix a title that is already marked", () => {
    expect(beamingTitle("⚡ Checkout rewrite", "cruel-dolphin")).toBe("⚡ Checkout rewrite");
  });
});
