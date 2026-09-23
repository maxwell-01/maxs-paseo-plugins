import { describe, expect, it } from "vitest";
import { applyBeamingTitle, readWorkspaceTitle, restoreWorkspaceTitle } from "./beam-title.server";
import { createFakeWorkspacePort } from "./workspace-port.fake";

describe("readWorkspaceTitle", () => {
  it("records no title and marks the display name for an untitled workspace", async () => {
    const { port } = createFakeWorkspacePort({ slug: "cruel-dolphin", title: null });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      originalTitle: null,
      markedTitle: "⚡ cruel-dolphin",
    });
  });

  it("marks the existing title of a titled workspace", async () => {
    const { port } = createFakeWorkspacePort({ slug: "cruel-dolphin", title: "Checkout rewrite" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      originalTitle: "Checkout rewrite",
      markedTitle: "⚡ Checkout rewrite",
    });
  });

  it("fails loudly rather than inventing a title when the workspace cannot be found", async () => {
    const { port } = createFakeWorkspacePort(null);
    await expect(readWorkspaceTitle(port, "ws-1")).rejects.toThrow("workspace ws-1 not found");
  });

  it("recovers the real title from a mark stranded by an earlier failed beam-out", async () => {
    const { port } = createFakeWorkspacePort({ slug: "cruel-dolphin", title: "⚡ Checkout rewrite" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      originalTitle: "Checkout rewrite",
      markedTitle: "⚡ Checkout rewrite",
    });
  });
});

describe("beam-in then beam-out", () => {
  it("returns an untitled workspace to having no title", async () => {
    const { port, currentTitle } = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const mark = await readWorkspaceTitle(port, "ws-1");
    await applyBeamingTitle(port, "ws-1", mark);
    expect(currentTitle()).toBe("⚡ beam-live");

    await restoreWorkspaceTitle(port, "ws-1", mark);
    expect(currentTitle()).toBeNull();
  });

  it("returns a titled workspace to its title", async () => {
    const { port, currentTitle } = createFakeWorkspacePort({ slug: "beam-live", title: "Checkout rewrite" });
    const mark = await readWorkspaceTitle(port, "ws-1");
    await applyBeamingTitle(port, "ws-1", mark);
    expect(currentTitle()).toBe("⚡ Checkout rewrite");

    await restoreWorkspaceTitle(port, "ws-1", mark);
    expect(currentTitle()).toBe("Checkout rewrite");
  });
});

describe("restoreWorkspaceTitle", () => {
  it("leaves the title alone when the beam predates title tracking", async () => {
    const { port, setTitleCalls } = createFakeWorkspacePort({ slug: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(port, "ws-1", undefined);
    expect(setTitleCalls).toEqual([]);
  });

  it("keeps a rename the user made during the beam instead of clobbering it", async () => {
    const { port, setTitleCalls } = createFakeWorkspacePort({ slug: "cruel-dolphin", title: "Payments migration" });
    await restoreWorkspaceTitle(port, "ws-1", {
      originalTitle: "Checkout rewrite",
      markedTitle: "⚡ Checkout rewrite",
    });
    expect(setTitleCalls).toEqual([]);
  });
});
