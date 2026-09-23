import { describe, expect, it } from "vitest";
import {
  applyBeamingTitle,
  beamingTitle,
  readWorkspaceTitle,
  restoreWorkspaceTitle,
  type WorkspaceTitlePort,
} from "./beam-title.server";

function fakePaseo(workspace: { name: string; title?: string | null } | null) {
  const calls: Array<string | null> = [];
  let state = workspace;
  const port = {
    workspaces: {
      ref: () => ({
        current: () => state,
        refresh: async () => state,
        setTitle: async (title: string | null) => {
          calls.push(title);
          state = state ? { ...state, title } : state;
          return { title };
        },
      }),
    },
  } satisfies WorkspaceTitlePort;
  return { port, calls };
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
  it("reads null when the workspace has no title of its own", async () => {
    const { port } = fakePaseo({ name: "cruel-dolphin" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      title: null,
      name: "cruel-dolphin",
    });
  });

  it("reports the workspace as unknown rather than inventing a title when the lookup misses", async () => {
    const { port } = fakePaseo(null);
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toBeNull();
  });

  it("recovers the real title from a mark stranded by an earlier failed beam-out", async () => {
    const { port } = fakePaseo({ name: "cruel-dolphin", title: "⚡ Checkout rewrite" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      title: "Checkout rewrite",
      name: "cruel-dolphin",
    });
  });

  it("recovers a null title from a stranded mark that only carried the workspace name", async () => {
    const { port } = fakePaseo({ name: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await expect(readWorkspaceTitle(port, "ws-1")).resolves.toEqual({
      title: null,
      name: "cruel-dolphin",
    });
  });
});

describe("applyBeamingTitle", () => {
  it("marks the workspace with the beaming prefix", async () => {
    const { port, calls } = fakePaseo({ name: "cruel-dolphin" });
    await applyBeamingTitle(port, "ws-1", null, "cruel-dolphin");
    expect(calls).toEqual(["⚡ cruel-dolphin"]);
  });
});

describe("restoreWorkspaceTitle", () => {
  it("puts back the title the workspace had before the beam", async () => {
    const { port, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ Checkout rewrite" });
    await restoreWorkspaceTitle(port, "ws-1", "Checkout rewrite");
    expect(calls).toEqual(["Checkout rewrite"]);
  });

  it("clears the title when the workspace had none before the beam", async () => {
    const { port, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(port, "ws-1", null);
    expect(calls).toEqual([null]);
  });

  it("leaves the title alone when the beam predates title tracking", async () => {
    const { port, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(port, "ws-1", undefined);
    expect(calls).toEqual([]);
  });

  it("keeps a rename the user made during the beam instead of clobbering it", async () => {
    const { port, calls } = fakePaseo({ name: "cruel-dolphin", title: "Payments migration" });
    await restoreWorkspaceTitle(port, "ws-1", "Checkout rewrite");
    expect(calls).toEqual([]);
  });
});
