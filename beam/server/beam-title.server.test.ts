import { describe, expect, it } from "vitest";
import { applyBeamingTitle, readWorkspaceTitle, restoreWorkspaceTitle } from "./beam-title.server";

function fakePaseo(workspace: { name: string; title?: string | null }) {
  const calls: Array<string | null> = [];
  const handle = {
    current: () => workspace,
    refresh: async () => workspace,
    setTitle: async (title: string | null) => {
      calls.push(title);
      return { title };
    },
  };
  return { paseo: { workspaces: { ref: () => handle } }, calls };
}

describe("readWorkspaceTitle", () => {
  it("reads null when the workspace has no title of its own", async () => {
    const { paseo } = fakePaseo({ name: "cruel-dolphin" });
    await expect(readWorkspaceTitle(paseo as never, "ws-1")).resolves.toEqual({
      title: null,
      name: "cruel-dolphin",
    });
  });
});

describe("applyBeamingTitle", () => {
  it("marks the workspace with the beaming prefix", async () => {
    const { paseo, calls } = fakePaseo({ name: "cruel-dolphin" });
    await applyBeamingTitle(paseo as never, "ws-1", null, "cruel-dolphin");
    expect(calls).toEqual(["⚡ cruel-dolphin"]);
  });
});

describe("restoreWorkspaceTitle", () => {
  it("puts back the title the workspace had before the beam", async () => {
    const { paseo, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ Checkout rewrite" });
    await restoreWorkspaceTitle(paseo as never, "ws-1", "Checkout rewrite");
    expect(calls).toEqual(["Checkout rewrite"]);
  });

  it("clears the title when the workspace had none before the beam", async () => {
    const { paseo, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(paseo as never, "ws-1", null);
    expect(calls).toEqual([null]);
  });

  it("leaves the title alone when the beam predates title tracking", async () => {
    const { paseo, calls } = fakePaseo({ name: "cruel-dolphin", title: "⚡ cruel-dolphin" });
    await restoreWorkspaceTitle(paseo as never, "ws-1", undefined);
    expect(calls).toEqual([]);
  });
});
