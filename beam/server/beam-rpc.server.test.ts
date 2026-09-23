import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentNotices } from "./beam-agent-notice.server";
import { beamIn, beamOut } from "./beam-rpc.server";
import { notifyAgentAfterTurn } from "./beam-turn-end.server";
import { createFakeAgentPort } from "./agent-port.fake";
import { getBeamLog } from "./beam.server";
import { createFakeWorkspacePort } from "./workspace-port.fake";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function combinePorts(
  workspace: ReturnType<typeof createFakeWorkspacePort>,
  agents: ReturnType<typeof createFakeAgentPort>,
) {
  return { ...workspace.port, ...agents.port };
}

function lastWarning(): string | undefined {
  return getBeamLog().filter((entry) => entry.level === "warn").at(-1)?.message;
}

describe("beam RPC handlers", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;
  let realHome: string | undefined;
  let beamInput: { workspaceId: string; workspaceName: string; workspaceDir: string };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-rpc-"));
    mainRepo = join(root, "main");
    wsDir = join(root, "ws");
    mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    writeFileSync(join(mainRepo, "tracked.txt"), "original\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");
    git(mainRepo, "worktree", "add", "-b", "feature", wsDir);
    beamInput = { workspaceId: "ws-1", workspaceName: "beam-live", workspaceDir: wsDir };

    realHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(() => {
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("marks the workspace on beam-in and restores it on beam-out", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });

    await beamIn(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices(), beamInput);
    expect(workspace.currentTitle()).toBe("⚡ beam-live");

    await beamOut(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices());
    expect(workspace.currentTitle()).toBeNull();
  });

  it("still beams in, and logs why, when the workspace title cannot be read", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null }, { refresh: true });

    await expect(beamIn(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices(), beamInput)).resolves.toEqual({
      active: true,
      mainPath: mainRepo,
    });
    expect(lastWarning()).toBe("could not read the workspace title: daemon unreachable");
    expect(workspace.currentTitle()).toBeNull();

    await beamOut(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices());
  });

  it("still reports beam-in success, and logs why, when the mark cannot be written", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null }, { setTitle: true });

    await expect(beamIn(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices(), beamInput)).resolves.toEqual({
      active: true,
      mainPath: mainRepo,
    });
    expect(lastWarning()).toBe("could not mark the workspace as beaming: daemon unreachable");

    await beamOut(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices());
  });

  it("still reports beam-out success, and logs why, when the title cannot be restored", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: "Checkout rewrite" });
    await beamIn(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices(), beamInput);
    workspace.failures.setTitle = true;

    await expect(beamOut(combinePorts(workspace, createFakeAgentPort([])), createAgentNotices())).resolves.toEqual({ active: false });
    expect(lastWarning()).toBe(
      "could not restore the workspace title to Checkout rewrite: daemon unreachable",
    );
  });

  it("tells idle agents in the workspace when the beam starts and when it stops", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const agents = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "idle" }]);
    const port = combinePorts(workspace, agents);
    const notices = createAgentNotices();

    await beamIn(port, notices, beamInput);
    await beamOut(port, notices);

    expect(agents.sent.map((message) => message.text)).toEqual([
      expect.stringContaining(`mirrored live onto the main checkout at ${mainRepo}`),
      expect.stringContaining(`no longer mirrored onto ${mainRepo}`),
    ]);
  });

  it("tells a working agent about the beam once its turn ends", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const agents = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "running" }]);
    const port = combinePorts(workspace, agents);
    const notices = createAgentNotices();

    await beamIn(port, notices, beamInput);
    expect(agents.sent).toEqual([]);

    await notifyAgentAfterTurn(port, notices, { id: "a1", workspaceId: "ws-1" }, { kind: "completed" });
    expect(agents.sent.map((message) => message.agentId)).toEqual(["a1"]);

    await beamOut(port, notices);
  });

  it("still beams in, and logs why, when an agent cannot be told", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const agents = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "idle" }], {
      failSendFor: ["a1"],
    });
    const port = combinePorts(workspace, agents);

    await expect(beamIn(port, createAgentNotices(), beamInput)).resolves.toEqual({
      active: true,
      mainPath: mainRepo,
    });
    expect(lastWarning()).toBe(
      "could not tell the workspace's agents about the beam: could not tell agent a1: daemon unreachable",
    );

    await beamOut(port, createAgentNotices());
  });

  it("does not message an agent whose turn was cancelled, because a new prompt is replacing it", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const agents = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "running" }]);
    const port = combinePorts(workspace, agents);
    const notices = createAgentNotices();
    await beamIn(port, notices, beamInput);

    await notifyAgentAfterTurn(port, notices, { id: "a1", workspaceId: "ws-1" }, { kind: "canceled" });
    expect(agents.sent).toEqual([]);

    await beamOut(port, notices);
  });

  it("sends nothing when the beam went in and out while the agent was working", async () => {
    const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
    const agents = createFakeAgentPort([{ id: "a1", workspaceId: "ws-1", status: "running" }]);
    const port = combinePorts(workspace, agents);
    const notices = createAgentNotices();

    await beamIn(port, notices, beamInput);
    await beamOut(port, notices);
    await notifyAgentAfterTurn(port, notices, { id: "a1", workspaceId: "ws-1" }, { kind: "completed" });

    expect(agents.sent).toEqual([]);
  });
});
