import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeAgentPort } from "./agent-port.fake";
import { createAgentBeam, resolveCallerWorkspace } from "./agent-beam.server";
import { readHolder, stopAllBeams } from "./beam.server";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("agent beam", () => {
  let root: string;
  let mainRepo: string;
  let ws1: string;
  let ws2: string;
  let realHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-agent-"));
    mainRepo = join(root, "main");
    ws1 = join(root, "ws1");
    ws2 = join(root, "ws2");
    mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    writeFileSync(join(mainRepo, "owner.txt"), "main\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");
    git(mainRepo, "worktree", "add", "-b", "one", ws1);
    git(mainRepo, "worktree", "add", "-b", "two", ws2);
    writeFileSync(join(ws1, "owner.txt"), "ws1\n");
    writeFileSync(join(ws2, "owner.txt"), "ws2\n");

    realHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(() => {
    stopAllBeams();
    vi.useRealTimers();
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  function fakeWorld() {
    return createFakeAgentPort({
      workspaces: {
        "ws-1": { name: "alpha", directory: ws1, title: null },
        "ws-2": { name: "beta", directory: ws2, title: "Checkout rewrite" },
      },
      agents: {
        "agent-a": { workspaceId: "ws-1", provider: "claude" },
        "agent-a2": { workspaceId: "ws-1", provider: "claude" },
        "agent-b": { workspaceId: "ws-2", provider: "claude" },
        "agent-lost": { workspaceId: null, provider: "claude" },
      },
    });
  }

  const mainOwner = () => readFileSync(join(mainRepo, "owner.txt"), "utf8");
  const signal = () => new AbortController().signal;

  describe("resolveCallerWorkspace", () => {
    it("returns the agent's workspace name, directory and provider", async () => {
      await expect(resolveCallerWorkspace(fakeWorld().port, "agent-b")).resolves.toEqual({
        workspaceId: "ws-2",
        workspaceName: "beta",
        workspaceDir: ws2,
      });
    });

    it("says the agent was not found", async () => {
      await expect(resolveCallerWorkspace(fakeWorld().port, "nobody")).rejects.toThrow(
        "agent nobody not found",
      );
    });

    it("says an agent without a workspace cannot beam", async () => {
      await expect(resolveCallerWorkspace(fakeWorld().port, "agent-lost")).rejects.toThrow(
        "agent agent-lost has no workspace",
      );
    });

    it("says when the agent's workspace is not listed", async () => {
      const world = fakeWorld();
      world.unlist("ws-2");

      await expect(resolveCallerWorkspace(world.port, "agent-b")).rejects.toThrow(
        "workspace ws-2 is not listed",
      );
    });

    it("says when the workspace has no directory", async () => {
      const world = createFakeAgentPort({
        workspaces: { "ws-1": { name: "alpha", directory: "", title: null } },
        agents: { "agent-a": { workspaceId: "ws-1", provider: "claude" } },
      });

      await expect(resolveCallerWorkspace(world.port, "agent-a")).rejects.toThrow(
        "workspace ws-1 has no directory",
      );
    });
  });

  describe("beamIn", () => {
    it("beams the caller's own workspace onto main and marks its title", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });

      await expect(beam.beamIn(world.port, "agent-a", { signal: signal() })).resolves.toEqual({
        result: "beamed-in",
      });

      expect(mainOwner()).toBe("ws1\n");
      expect(world.titleOf("ws-1")).toBe("⚡ alpha");
      expect(readHolder()?.workspaceId).toBe("ws-1");
    });

    it("does nothing when the caller's workspace already holds the beam", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      const startedAt = readHolder()?.startedAt;

      await expect(beam.beamIn(world.port, "agent-a2", { signal: signal() })).resolves.toEqual({
        result: "already-yours",
      });

      expect(readHolder()?.startedAt).toBe(startedAt);
    });

    it("with waitSeconds 0 names the holder and leaves main on the holder's files", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      const outcome = await beam.beamIn(world.port, "agent-b", { waitSeconds: 0, signal: signal() });

      expect(outcome).toMatchObject({ result: "held", holder: { workspaceId: "ws-1", workspaceName: "alpha" } });
      expect(mainOwner()).toBe("ws1\n");
    });

    it("beams a waiter in after the holder beams out", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      const waiting = beam.beamIn(world.port, "agent-b", { waitSeconds: 5, signal: signal() });
      await new Promise((done) => setTimeout(done, 50));
      expect(mainOwner()).toBe("ws1\n");
      await beam.beamOut(world.port, "agent-a");

      await expect(waiting).resolves.toEqual({ result: "beamed-in" });
      expect(mainOwner()).toBe("ws2\n");
      expect(world.titleOf("ws-2")).toBe("⚡ Checkout rewrite");
    });

    it("names the holder and the time waited when the wait runs out", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      const outcome = await beam.beamIn(world.port, "agent-b", { waitSeconds: 0.1, signal: signal() });

      expect(outcome).toMatchObject({ result: "held", holder: { workspaceId: "ws-1" } });
      expect(outcome.result === "held" && outcome.waitedSeconds).toBeGreaterThanOrEqual(0.1);
      expect(mainOwner()).toBe("ws1\n");
    });

    it("never beams in after the wait was aborted", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      const controller = new AbortController();

      const waiting = beam.beamIn(world.port, "agent-b", { waitSeconds: 5, signal: controller.signal });
      await new Promise((done) => setTimeout(done, 50));
      controller.abort();
      await expect(waiting).resolves.toEqual({ result: "aborted" });
      await beam.beamOut(world.port, "agent-a");
      await new Promise((done) => setTimeout(done, 100));

      expect(readHolder()).toBeNull();
      expect(mainOwner()).toBe("main\n");
    });

    it("releases a holder whose workspace was archived, then beams the caller in", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      world.unlist("ws-1");

      await expect(
        beam.beamIn(world.port, "agent-b", { waitSeconds: 0, signal: signal() }),
      ).resolves.toEqual({ result: "beamed-in" });

      expect(mainOwner()).toBe("ws2\n");
      expect(readHolder()?.workspaceId).toBe("ws-2");
    });

    it("stops waiting at once when the signal was aborted during the attempt", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 60_000 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      const controller = new AbortController();
      let callerRefreshes = 0;
      const port = {
        ...world.port,
        workspaces: {
          ref: (workspaceId: string) => {
            const handle = world.port.workspaces.ref(workspaceId);
            if (workspaceId !== "ws-2") {
              return handle;
            }
            return {
              ...handle,
              refresh: async () => {
                callerRefreshes += 1;
                if (callerRefreshes === 2) {
                  controller.abort();
                }
                return handle.refresh();
              },
            };
          },
        },
      };
      const startedAt = Date.now();

      await expect(
        beam.beamIn(port, "agent-b", { waitSeconds: 120, signal: controller.signal }),
      ).resolves.toEqual({ result: "aborted" });

      expect(Date.now() - startedAt).toBeLessThan(5_000);
    });

    it("fails clearly for an agent without a workspace", async () => {
      await expect(
        createAgentBeam({ pollMs: 10 }).beamIn(fakeWorld().port, "agent-lost", { signal: signal() }),
      ).rejects.toThrow("agent agent-lost has no workspace");
    });
  });

  describe("beamOut", () => {
    it("lets any agent in the holding workspace beam out, restoring main and the title", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      await expect(beam.beamOut(world.port, "agent-a2")).resolves.toEqual({ result: "beamed-out" });

      expect(mainOwner()).toBe("main\n");
      expect(world.titleOf("ws-1")).toBeNull();
      expect(readHolder()).toBeNull();
    });

    it("refuses an agent from another workspace and names the holder", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      const outcome = await beam.beamOut(world.port, "agent-b");

      expect(outcome).toMatchObject({ result: "not-yours", holder: { workspaceId: "ws-1" } });
      expect(mainOwner()).toBe("ws1\n");
    });

    it("says there is no beam when nothing is beaming", async () => {
      await expect(
        createAgentBeam({ pollMs: 10 }).beamOut(fakeWorld().port, "agent-a"),
      ).resolves.toEqual({ result: "no-beam" });
    });
  });

  describe("status", () => {
    it("tells whether the caller's workspace holds the beam", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await expect(beam.status(world.port, "agent-a")).resolves.toEqual({
        active: false,
        callerHolds: false,
      });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      await expect(beam.status(world.port, "agent-a2")).resolves.toMatchObject({
        active: true,
        holder: { workspaceId: "ws-1" },
        callerHolds: true,
      });
      await expect(beam.status(world.port, "agent-b")).resolves.toMatchObject({
        active: true,
        holder: { workspaceId: "ws-1" },
        callerHolds: false,
      });
      await expect(beam.status(world.port, null)).resolves.toMatchObject({
        active: true,
        callerHolds: false,
      });
    });

    it("asks the daemon nothing about the caller while no beam is active", async () => {
      const beam = createAgentBeam({ pollMs: 10 });

      await expect(beam.status(fakeWorld().port, "nobody")).resolves.toEqual({
        active: false,
        callerHolds: false,
      });
    });

    it("reports the beam with callerHolds false for an agent without a workspace", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });

      await expect(beam.status(world.port, "agent-lost")).resolves.toMatchObject({
        active: true,
        holder: { workspaceId: "ws-1" },
        callerHolds: false,
      });
    });

    it("propagates a daemon failure while looking up the caller", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      const port = {
        ...world.port,
        agents: {
          ref: () => ({
            refresh: async () => {
              throw new Error("daemon unreachable");
            },
          }),
        },
      };

      await expect(beam.status(port, "agent-a")).rejects.toThrow("daemon unreachable");
    });

    it("reports a holder whose workspace was archived as released", async () => {
      const world = fakeWorld();
      const beam = createAgentBeam({ pollMs: 10 });
      await beam.beamIn(world.port, "agent-a", { signal: signal() });
      world.unlist("ws-1");

      await expect(beam.status(world.port, "agent-b")).resolves.toEqual({
        active: false,
        callerHolds: false,
      });
      expect(mainOwner()).toBe("main\n");
    });
  });
});
