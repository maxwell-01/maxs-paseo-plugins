import { describe, expect, it } from "vitest";
import {
  applyBeamingTitle,
  beamingTitle,
  readWorkspaceTitle,
  restoreWorkspaceTitle,
  type WorkspaceTitlePort,
} from "./beam-title.server";

function fakePaseo(workspace: { slug: string; title: string | null } | null) {
  const calls: Array<string | null> = [];
  let state = workspace;
  const port = {
    workspaces: {
      ref: () => ({
        current: () => (state ? { name: state.title ?? state.slug, title: state.title } : null),
        refresh: async () => state,
        setTitle: async (title: string | null) => {
          calls.push(title);
          state = state ? { ...state, title } : state;
          return { title };
        },
      }),
    },
  } satisfies WorkspaceTitlePort;
  return { port, calls, current: () => state };
}

describe("beamingTitle", () => {
  it("falls back to the workspace name when the workspace has no title", () => {
    expect(beamingTitle(null, "cruel-dolphin")).toBe("⚡ cruel-dolphin");
  });

  it("prefixes the existing title when the workspace has one", () => {
    expect(beamingTitle("Checkout rewrite", "cruel-dolphin")).toBe("⚡ Checkout rewrite");
  });
});

describe("readWorkspaceTitle", () => {
  it("records no title and the display name for an untitled workspace", async () => {
    const { port } = fakePaseo({ slug: "cruel-dolphin", title: null });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      originalTitle: null,
      markedTitle: "⚡ cruel-dolphin",
    });
  });

  it("reports the workspace as unknown rather than inventing a title when the lookup misses", async () => {
    const { port } = fakePaseo(null);
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toBeNull();
  });

  it("recovers the real title from a mark stranded by an earlier failed beam-out", async () => {
    const { port } = fakePaseo({ slug: "cruel-dolphin", title: "⚡ Checkout rewrite" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      originalTitle: "Checkout rewrite",
      markedTitle: "⚡ Checkout rewrite",
    });
  });
});

describe("beam-in then beam-out", () => {
  it("returns an untitled workspace to having no title", async () => {
    const { port, current } = fakePaseo({ slug: "beam-live", title: null });
    const mark = await readWorkspaceTitle(port, "ws-1");
    await applyBeamingTitle(port, "ws-1", mark!);
    expect(current()?.title).toBe("⚡ beam-live");

    await restoreWorkspaceTitle(port, "ws-1", mark!);
    expect(current()?.title).toBeNull();
  });

  it("returns a titled workspace to its title", async () => {
    const { port, current } = fakePaseo({ slug: "beam-live", title: "Checkout rewrite" });
    const mark = await readWorkspaceTitle(port, "ws-1");
    await applyBeamingTitle(port, "ws-1", mark!);
    expect(current()?.title).toBe("⚡ Checkout rewrite");

    await restoreWorkspaceTitle(port, "ws-1", mark!);
    expect(current()?.title).toBe("Checkout rewrite");
  });
});

describe("restoreWorkspaceTitle", () => {
  it("leaves the title alone when the beam predates title tracking", async () => {
    const { port, calls } = fakePaseo({ slug: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(port, "ws-1", undefined);
    expect(calls).toEqual([]);
  });

  it("keeps a rename the user made during the beam instead of clobbering it", async () => {
    const { port, calls } = fakePaseo({ slug: "cruel-dolphin", title: "Payments migration" });
    await restoreWorkspaceTitle(port, "ws-1", {
      originalTitle: "Checkout rewrite",
      markedTitle: "⚡ Checkout rewrite",
    });
    expect(calls).toEqual([]);
  });
});
