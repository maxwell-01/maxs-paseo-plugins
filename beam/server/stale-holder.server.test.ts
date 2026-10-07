import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beamIn, beamOut } from "./beam-rpc.server";
import { type BeamHolder, getBeamLog, readHolder, status, stopAllBeams } from "./beam.server";
import {
  findStaleReason,
  registerStaleHolderRelease,
  releaseStaleHolder,
} from "./stale-holder.server";
import { createFakeWorkspacePort } from "./workspace-port.fake";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function lastWarning(): string | undefined {
  return getBeamLog().filter((entry) => entry.level === "warn").at(-1)?.message;
}

describe("stale holder release", () => {
  let root: string;
  let mainRepo: string;
  let wsDir: string;
  let realHome: string | undefined;
  let beamInput: { workspaceId: string; workspaceName: string; workspaceDir: string };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "beam-stale-"));
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
    writeFileSync(join(wsDir, "tracked.txt"), "from the workspace\n");
    beamInput = { workspaceId: "ws-1", workspaceName: "beam-live", workspaceDir: wsDir };

    realHome = process.env.HOME;
    process.env.HOME = root;
  });

  afterEach(() => {
    stopAllBeams();
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  function holderOrFail(): BeamHolder {
    const holder = readHolder();
    if (!holder) {
      throw new Error("expected a beam to be active");
    }
    return holder;
  }

  describe("findStaleReason", () => {
    it("keeps a holder whose workspace is listed and not being archived", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(workspace.port, beamInput);

      await expect(findStaleReason(workspace.port, holderOrFail())).resolves.toBeNull();
    });

    it("flags a holder whose directory was deleted, without asking the daemon", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(workspace.port, beamInput);
      rmSync(wsDir, { recursive: true });
      workspace.failures.refresh = true;

      await expect(findStaleReason(workspace.port, holderOrFail())).resolves.toBe(
        "its directory no longer exists",
      );
    });

    it("flags a holder whose workspace is no longer listed", async () => {
      await beamIn(createFakeWorkspacePort({ slug: "beam-live", title: null }).port, beamInput);
      const unlisted = createFakeWorkspacePort(null);

      await expect(findStaleReason(unlisted.port, holderOrFail())).resolves.toBe(
        "its workspace is no longer listed",
      );
    });

    it("flags a holder whose workspace is being archived", async () => {
      const workspace = createFakeWorkspacePort({
        slug: "beam-live",
        title: null,
        archivingAt: "2026-10-07T10:00:00.000Z",
      });
      await beamIn(workspace.port, beamInput);

      await expect(findStaleReason(workspace.port, holderOrFail())).resolves.toBe(
        "its workspace is being archived",
      );
    });

    it("propagates a failed lookup instead of calling the holder dead", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(workspace.port, beamInput);
      workspace.failures.refresh = true;

      await expect(findStaleReason(workspace.port, holderOrFail())).rejects.toThrow("daemon unreachable");
    });
  });

  describe("releaseStaleHolder", () => {
    it("beams out a dead holder: main is restored, the title is restored, the release is logged", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: "Checkout rewrite" });
      await beamIn(workspace.port, beamInput);
      expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe("from the workspace\n");
      workspace.startArchiving("2026-10-07T10:00:00.000Z");

      await releaseStaleHolder(workspace.port);

      expect(readFileSync(join(mainRepo, "tracked.txt"), "utf8")).toBe("original\n");
      await expect(status()).resolves.toMatchObject({ active: false });
      expect(lastWarning()).toBe('released beam of "beam-live": its workspace is being archived');
    });

    it("leaves a live holder beaming", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(workspace.port, beamInput);

      await releaseStaleHolder(workspace.port);

      expect(readHolder()?.workspaceId).toBe("ws-1");
    });

    it("does nothing, and asks no one, when nothing is beaming", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null }, { refresh: true });

      await expect(releaseStaleHolder(workspace.port)).resolves.toBeUndefined();
    });

    it("keeps the beam and propagates the error when the lookup fails", async () => {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(workspace.port, beamInput);
      workspace.failures.refresh = true;

      await expect(releaseStaleHolder(workspace.port)).rejects.toThrow("daemon unreachable");
      expect(readHolder()?.workspaceId).toBe("ws-1");
    });

    it("does not beam out a newer beam that replaced the stale holder during the lookup", async () => {
      const first = createFakeWorkspacePort({ slug: "beam-live", title: null });
      await beamIn(first.port, beamInput);
      const staleLookup = createFakeWorkspacePort(null);
      const racingPort = {
        workspaces: {
          ref: () => ({
            ...staleLookup.port.workspaces.ref(),
            refresh: async () => {
              await beamOutAndBackIn();
              return null;
            },
          }),
        },
      };
      async function beamOutAndBackIn() {
        await beamOut(first.port);
        await beamIn(first.port, { ...beamInput, workspaceId: "ws-newer", workspaceName: "newer" });
      }
      await releaseStaleHolder(racingPort);

      const holder = holderOrFail();
      expect(holder.workspaceId).toBe("ws-newer");
    });
  });

  describe("registerStaleHolderRelease", () => {
    function register() {
      const workspace = createFakeWorkspacePort({ slug: "beam-live", title: null });
      let archived: Parameters<Parameters<typeof registerStaleHolderRelease>[0]["on"]>[1] | undefined;
      registerStaleHolderRelease({
        on: (_name, handler) => {
          archived = handler;
        },
      });
      const fire = (workspaceId: string) =>
        archived?.({ workspace: { id: workspaceId } }, { paseo: workspace.port });
      return { workspace, fire };
    }

    it("beams out when the archived workspace is the holder", async () => {
      const { workspace, fire } = register();
      await beamIn(workspace.port, beamInput);

      await fire("ws-1");

      await expect(status()).resolves.toMatchObject({ active: false });
      expect(lastWarning()).toBe('released beam of "beam-live": its workspace was archived');
    });

    it("keeps the beam when another workspace is archived", async () => {
      const { workspace, fire } = register();
      await beamIn(workspace.port, beamInput);

      await fire("ws-other");

      expect(readHolder()?.workspaceId).toBe("ws-1");
    });
  });
});
