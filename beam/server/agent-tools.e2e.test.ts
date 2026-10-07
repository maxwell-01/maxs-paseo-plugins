import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentBeam } from "./agent-beam.server";
import { createFakeAgentPort } from "./agent-port.fake";
import { createBeamTools } from "./beam-tools.server";
import { readHolder, stopAllBeams } from "./beam.server";
import { runCli, startProxy } from "./proxy-process.test-support";
import { installToolProxy } from "./tool-proxy.server";
import { serveTools } from "./tool-socket.server";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const POLL_MS = 50;

describe("beam tools through the real socket and proxy", () => {
  let root: string;
  let mainRepo: string;
  let proxyPath: string;
  let realHome: string | undefined;
  const cleanups: (() => void)[] = [];

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "beam-e2e-"));
    mainRepo = join(root, "main");
    mkdirSync(mainRepo, { recursive: true });
    git(mainRepo, "init", "-b", "main");
    git(mainRepo, "config", "user.email", "beam-test@example.com");
    git(mainRepo, "config", "user.name", "Beam Test");
    git(mainRepo, "config", "commit.gpgsign", "false");
    writeFileSync(join(mainRepo, "owner.txt"), "main\n");
    git(mainRepo, "add", "-A");
    git(mainRepo, "commit", "-m", "initial");
    const workspaceDirs = ["ws1", "ws2"].map((name) => join(root, name));
    workspaceDirs.forEach((dir, index) => {
      git(mainRepo, "worktree", "add", "-b", `branch-${index}`, dir);
      writeFileSync(join(dir, "owner.txt"), `ws${index + 1}\n`);
    });

    realHome = process.env.HOME;
    process.env.HOME = root;

    const world = createFakeAgentPort({
      workspaces: {
        "ws-1": { name: "alpha", directory: workspaceDirs[0], title: null },
        "ws-2": { name: "beta", directory: workspaceDirs[1], title: null },
      },
      agents: {
        "agent-a": { workspaceId: "ws-1", provider: "claude" },
        "agent-b": { workspaceId: "ws-2", provider: "claude" },
      },
    });
    const tools = createBeamTools({ agentBeam: createAgentBeam({ pollMs: POLL_MS }), paseo: () => world.port });
    const socketPath = join(root, "state", "tools.sock");
    proxyPath = installToolProxy(join(root, "state"), { socketPath, tools: tools.definitions, pluginTimeoutMs: 40_000 });
    cleanups.push(await serveTools(socketPath, tools));
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    stopAllBeams();
    process.env.HOME = realHome;
    rmSync(root, { recursive: true, force: true });
  });

  const mainOwner = () => readFileSync(join(mainRepo, "owner.txt"), "utf8");
  const agent = (agentId: string) => {
    const proxy = startProxy(proxyPath, agentId);
    cleanups.push(() => proxy.child.kill());
    const call = (name: string, args: object = {}) => proxy.start("tools/call", { name, arguments: args });
    return { ...proxy, call };
  };
  const textOf = (reply: { result?: { content: { text: string }[] } }) => reply.result?.content[0].text ?? "";

  it("lets agent B wait for agent A to beam out, then beams B in", async () => {
    const a = agent("agent-a");
    const b = agent("agent-b");

    expect(textOf(await a.call("beam_in").reply)).toContain("Beamed in");
    expect(mainOwner()).toBe("ws1\n");

    let bDone = false;
    const bIn = b.call("beam_in", { waitSeconds: 5 }).reply.then((reply) => {
      bDone = true;
      return reply;
    });
    await new Promise((done) => setTimeout(done, 300));
    expect(bDone).toBe(false);

    expect(textOf(await a.call("beam_out").reply)).toContain("Beamed out");
    expect(textOf(await bIn)).toContain("Beamed in");
    expect(mainOwner()).toBe("ws2\n");
    expect(readHolder()?.workspaceId).toBe("ws-2");
  });

  it("never beams in agent B when its proxy dies while it waits", async () => {
    const a = agent("agent-a");
    const b = agent("agent-b");
    await a.call("beam_in").reply;

    b.call("beam_in", { waitSeconds: 5 });
    await new Promise((done) => setTimeout(done, 300));
    b.child.kill();
    await new Promise((done) => b.child.on("close", done));
    await a.call("beam_out").reply;
    await new Promise((done) => setTimeout(done, POLL_MS * 4));

    expect(readHolder()).toBeNull();
    expect(mainOwner()).toBe("main\n");
  });

  it("serves a command-line call through the same script", async () => {
    const status = await runCli(proxyPath, ["beam_status"], "agent-a");
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toEqual({ active: false, youHoldIt: false });

    const beamIn = await runCli(proxyPath, ["beam_in", "--wait", "0"], "agent-a");
    expect(beamIn.code).toBe(0);
    expect(beamIn.stdout).toContain("Beamed in");
    expect(mainOwner()).toBe("ws1\n");

    const rival = await runCli(proxyPath, ["beam_in", "--wait", "0"], "agent-b");
    expect(rival.code).toBe(0);
    expect(rival.stdout).toContain('held by workspace "alpha"');
  });
});
