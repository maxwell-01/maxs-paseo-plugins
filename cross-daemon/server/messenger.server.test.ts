import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import { createMessageQueue } from "./message-queue.server";
import { createMessenger } from "./messenger.server";
import type { PaseoCli } from "./paseo-cli.server";
import { createWatchList } from "./watch-list.server";

const mac: Peer = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=bWFj" };
const FULL_ID = "a1b2c3d4-0000-4000-8000-000000000001";

interface FakeAgent {
  status: string;
  updatedAt: string;
  archived?: boolean;
}

// A remote daemon (and this one) that resolves ID prefixes like Paseo does, with hooks to fail or
// slow down a command.
function fakeDaemons() {
  const agents = new Map<string, FakeAgent>();
  const sends: { where: string; agentId: string; text: string }[] = [];
  let sendFailure: Error | null = null;
  let inspectDelayMs = 0;
  const resolve = (where: string, ref: string) => {
    const matches = [...agents.keys()].filter((key) => key.startsWith(`${where}/${ref}`));
    if (matches.length === 0) throw new Error(`Agent not found: ${ref}`);
    if (matches.length > 1) throw new Error(`Agent identifier ${ref} is ambiguous`);
    return matches[0].slice(where.length + 1);
  };
  const handle = async (where: string, args: readonly string[], promptText?: string) => {
    const [command, ref] = args;
    const id = resolve(where, ref);
    const agent = agents.get(`${where}/${id}`)!;
    if (command === "inspect") {
      await new Promise((done) => setTimeout(done, inspectDelayMs));
      return JSON.stringify({ Id: id, Status: agent.status, UpdatedAt: agent.updatedAt, Archived: agent.archived ?? false });
    }
    if (command === "send") {
      if (sendFailure) throw sendFailure;
      sends.push({ where, agentId: id, text: promptText ?? "" });
      Object.assign(agent, { status: "running", updatedAt: new Date().toISOString() });
      return "{}";
    }
    if (command === "logs") return "";
    throw new Error(`unexpected command ${command}`);
  };
  const cli: PaseoCli = {
    run: (_link, args, options) => handle("mac", args, options?.promptText),
    runLocal: (args, options) => handle("local", args, options?.promptText),
  };
  return {
    cli,
    sends,
    put: (where: string, id: string, status: string, extra: Partial<FakeAgent> = {}) =>
      agents.set(`${where}/${id}`, { status, updatedAt: "2020-01-01T00:00:00.000Z", ...extra }),
    setStatus: (where: string, id: string, status: string) => Object.assign(agents.get(`${where}/${id}`)!, { status }),
    failSends: (error: Error | null) => {
      sendFailure = error;
    },
    slowInspect: (ms: number) => {
      inspectDelayMs = ms;
    },
  };
}

function setup(options: { now?: () => number } = {}) {
  const daemons = fakeDaemons();
  const dir = mkdtempSync(join(tmpdir(), "cd-messenger-"));
  const queue = createMessageQueue(dir);
  const watches = createWatchList(dir);
  const messenger = createMessenger({ queue, watches, readPeers: () => [mac], cli: daemons.cli, now: options.now });
  const send = (agentRef: string, callerAgentId: string | null = "caller-1") =>
    messenger.send({ peer: mac, agentRef, text: "hello", callerAgentId, notifyOnFinish: false });
  const noticesTo = (id: string) => daemons.sends.filter((entry) => entry.where === "local" && entry.agentId === id);
  return { ...daemons, dir, queue, watches, messenger, send, noticesTo };
}

afterEach(() => vi.restoreAllMocks());

describe("never interrupting a working agent", () => {
  it("sends only one of two messages that race to the same idle agent, and queues the other", async () => {
    const t = setup();
    t.put("mac", FULL_ID, "idle");
    t.slowInspect(20);
    const outcomes = await Promise.all([t.send(FULL_ID), t.send(FULL_ID)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["queued", "sent"]);
    expect(t.sends).toHaveLength(1);
  });

  it("treats an ID prefix and the full ID as the same agent", async () => {
    const t = setup();
    t.put("mac", FULL_ID, "running");
    await t.send("a1b2c3d");
    await t.send(FULL_ID);
    t.setStatus("mac", FULL_ID, "idle");
    await t.messenger.runRound();
    expect(t.sends).toHaveLength(1);
    expect(t.queue.list()).toHaveLength(1);
    expect(t.queue.list()[0].agentId).toBe(FULL_ID);
  });
});

describe("messages that cannot be delivered", () => {
  it("drops a message that waited too long, and tells the sender", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let now = Date.parse("2026-01-01T00:00:00Z");
    const t = setup({ now: () => now });
    t.put("mac", FULL_ID, "running");
    t.put("local", "caller-1", "idle");
    await t.send(FULL_ID);
    now += 25 * 60 * 60 * 1000;
    await t.messenger.runRound();
    await t.messenger.runRound();
    expect(t.queue.list()).toEqual([]);
    expect(t.noticesTo("caller-1")[0].text).toContain("was not delivered");
  });

  it("drops a message to an agent that became archived, and tells the sender", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    t.put("mac", FULL_ID, "running");
    t.put("local", "caller-1", "idle");
    await t.send(FULL_ID);
    t.put("mac", FULL_ID, "idle", { archived: true });
    await t.messenger.runRound();
    await t.messenger.runRound();
    expect(t.sends.filter((entry) => entry.where === "mac")).toEqual([]);
    expect(t.noticesTo("caller-1")[0].text).toContain("archived");
  });

  it("keeps a message whose daemon is switched off for a while, until it expires", async () => {
    const t = setup();
    t.put("mac", FULL_ID, "running");
    await t.send(FULL_ID);
    const offline = createMessenger({ queue: t.queue, watches: t.watches, readPeers: () => [], cli: t.cli });
    await offline.runRound();
    expect(t.queue.list()).toHaveLength(1);
  });

  it("refuses more than 20 waiting messages for one agent", async () => {
    const t = setup();
    t.put("mac", FULL_ID, "running");
    for (let i = 0; i < 20; i++) await t.send(FULL_ID);
    await expect(t.send(FULL_ID)).rejects.toThrow("20 messages are already waiting");
  });
});

describe("sends that may have gone through", () => {
  it("does not send again a message whose send was cut off by a restart, and tells the sender", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    t.put("mac", FULL_ID, "running");
    t.put("local", "caller-1", "idle");
    await t.send(FULL_ID);
    t.queue.markInFlight(t.queue.list()[0].id);
    t.setStatus("mac", FULL_ID, "idle");
    await t.messenger.runRound();
    await t.messenger.runRound();
    expect(t.sends.filter((entry) => entry.where === "mac")).toEqual([]);
    expect(t.noticesTo("caller-1")[0].text).toContain("may have been delivered");
  });

  it("reports a send that timed out as possibly delivered instead of retrying it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setup();
    t.put("mac", FULL_ID, "idle");
    t.failSends(new Error("paseo timed out after 90 s"));
    await expect(t.send(FULL_ID)).rejects.toThrow("may have been delivered");
  });
});

describe("delivery rounds", () => {
  it("survives an unreadable queue file, setting it aside instead of failing every round", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = setup();
    writeFileSync(join(t.dir, "queue.json"), "{ not json");
    await expect(t.messenger.runRound()).resolves.toBeUndefined();
    expect(readdirSync(t.dir).some((name) => name.startsWith("queue.json.unreadable-"))).toBe(true);
  });
});
