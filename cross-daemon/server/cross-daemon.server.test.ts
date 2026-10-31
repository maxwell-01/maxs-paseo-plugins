import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import { registerCrossDaemon } from "./cross-daemon.server";
import { makeTempDir } from "./temp-dir.test-support";

const tower: Peer = { serverId: "srv_tower", name: "tower", link: "https://app.paseo.sh/#offer=dG93ZXI" };
const mac: Peer = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=bWFj" };
const brs: Peer = { serverId: "srv_brs", name: "brs", link: "https://app.paseo.sh/#offer=YnJz" };
const testDaemonKey = randomBytes(32);

type State = PluginSettingsState<any>;
const on: State = { status: "ready", revision: "r1", values: { enabled: true } };
const off: State = { status: "ready", revision: "r2", values: { enabled: false } };
const invalid: State = { status: "invalid", revision: "r3", error: "schema version 9 is newer" };

function startPlugin(initial: State, stored: Peer[] = [], stateDirOverride?: Promise<string>, relayEnabled = true, daemonSecretKey: Uint8Array = testDaemonKey) {
  const stateDir = join(makeTempDir("cd-"), "cross-daemon");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "peers.json"), JSON.stringify(stored));
  let state = initial;
  const listeners = new Set<(next: State) => void>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const hooks = new Map<string, (input: { request: unknown }) => unknown>();
  const context = { paseo: { config: { get: async () => ({ config: { relay: { enabled: relayEnabled } } }) } } as unknown as PaseoApi };
  const server = {
    registerSettings: () => ({
      read: async () => state,
      subscribe: (listener: (next: State) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    handle: (contract: { name: string }, handler: (input: unknown, ctx: unknown) => unknown) =>
      handlers.set(contract.name, (input) => handler(input, context)),
    registerProvider: () => {},
    on: () => () => {},
    before: (name: string, hook: (input: { request: unknown }) => unknown) => hooks.set(name, hook),
  } as unknown as PluginServerContext;
  const reachedPeers: Peer[] = [];
  const dispose = registerCrossDaemon(server, { readOwnPeer: async (relayOn: boolean) => (relayOn ? tower : null), stateDir: stateDirOverride ?? Promise.resolve(stateDir),
    daemonSecretKey: Promise.resolve(daemonSecretKey),
    cli: {
      run: async (peer: Peer) => {
        reachedPeers.push(peer);
        return "[]";
      },
      runLocal: async () => "[]",
    },
    ownDaemon: async () => ({ name: "tower", serverId: "srv_tower" }),
  });
  stops.push(async () => {
    await dispose().catch(() => {});
  });
  return {
    storedPeers: () => JSON.parse(readFileSync(join(stateDir, "peers.json"), "utf8")),
    call: async (name: string, input: unknown = {}) => handlers.get(name)!(input),
    switchTo: async (next: State) => {
      state = next;
      await Promise.all([...listeners].map((listener) => listener(next)));
    },
    settle: () => new Promise((resolve) => setTimeout(resolve, 10)),
    createAgent: async (config: object) => hooks.get("agent.create")!({ request: { config } }),
    passwordUsedFor: async (daemon: string) => {
      await callTool(join(await (stateDirOverride ?? Promise.resolve(stateDir)), "tools.sock"), "list_workspaces", { daemon });
      return reachedPeers.at(-1)?.password;
    },
    stateDir,
  };
}

async function callTool(socketPath: string, name: string, args: object): Promise<unknown> {
  const reply = await new Promise<string>((resolve, reject) => {
    let body = "";
    const socket = createConnection(socketPath);
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => (body += chunk));
    socket.on("end", () => resolve(body));
    socket.on("error", reject);
    socket.end(JSON.stringify({ type: "call", name, arguments: args, callerAgentId: null }));
  });
  return JSON.parse(reply);
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

describe("cross-daemon switch", () => {
  it("clears peers left from before a restart when the daemon starts switched off", async () => {
    const plugin = startPlugin(off, [mac]);
    await plugin.settle();
    expect(plugin.storedPeers()).toEqual([]);
  });

  it("treats unreadable settings as switched off and clears peers", async () => {
    const plugin = startPlugin(invalid, [mac]);
    await plugin.settle();
    expect(plugin.storedPeers()).toEqual([]);
  });

  it("keeps peers across a restart while switched on", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.settle();
    expect(plugin.storedPeers()).toEqual([mac]);
  });

  it("clears peers the moment the daemon is switched off", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.switchTo(off);
    await plugin.settle();
    expect(plugin.storedPeers()).toEqual([]);
  });

  it("shares this daemon's link only while switched on", async () => {
    const plugin = startPlugin(on);
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({ serverId: "srv_tower", switchedOn: true, passwordSet: false, member: tower });
    await plugin.switchTo(off);
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({ serverId: "srv_tower", switchedOn: false, passwordSet: false, member: null });
  });

  it("stores the other daemons it is given while switched on, but never itself", async () => {
    const plugin = startPlugin(on);
    await expect(
      plugin.call("cross-daemon.set-peers", { peers: [tower, mac], answeredServerIds: ["srv_tower", "srv_mac"] }),
    ).resolves.toEqual({ stored: 1 });
    expect(plugin.storedPeers()).toEqual([mac]);
  });

  it("keeps a stored peer that did not answer this sync, such as a sleeping Mac", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.call("cross-daemon.set-peers", { peers: [], answeredServerIds: ["srv_tower"] });
    expect(plugin.storedPeers()).toEqual([mac]);
  });

  it("drops a stored peer that answered switched off", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.call("cross-daemon.set-peers", { peers: [], answeredServerIds: ["srv_tower", "srv_mac"] });
    expect(plugin.storedPeers()).toEqual([]);
  });

  it("replaces a stored peer's link with the one it just gave", async () => {
    const renewed = { ...mac, link: "https://app.paseo.sh/#offer=bmV3" };
    const plugin = startPlugin(on, [mac]);
    await plugin.call("cross-daemon.set-peers", { peers: [renewed], answeredServerIds: ["srv_mac"] });
    expect(plugin.storedPeers()).toEqual([renewed]);
  });

  it("lists its peers by name and server ID, never by link", async () => {
    const plugin = startPlugin(on, [mac]);
    await expect(plugin.call("cross-daemon.list-peers")).resolves.toEqual({ peers: [{ serverId: "srv_mac", name: "mac", password: "none" }] });
  });

  it("still reports its server ID when its relay is off, so the app can match it to a host", async () => {
    const plugin = startPlugin(on, [], undefined, false);
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({ serverId: "srv_tower", switchedOn: true, passwordSet: false, member: null });
  });

  it("stores no peers while switched off", async () => {
    const plugin = startPlugin(off);
    await expect(plugin.call("cross-daemon.set-peers", { peers: [mac], answeredServerIds: ["srv_mac"] })).resolves.toEqual({ stored: 0 });
    expect(plugin.storedPeers()).toEqual([]);
  });
});

describe("this daemon's password", () => {
  it("gives its password to its peers with its link, so they can reach it over the relay", async () => {
    const plugin = startPlugin(on);
    await expect(plugin.call("cross-daemon.set-own-password", { password: "tower-password" })).resolves.toEqual({ passwordSet: true });
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({
      serverId: "srv_tower",
      switchedOn: true,
      passwordSet: true,
      member: { ...tower, password: "tower-password" },
    });
  });

  it("shares no password while switched off", async () => {
    const plugin = startPlugin(off);
    await plugin.call("cross-daemon.set-own-password", { password: "tower-password" });
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({ serverId: "srv_tower", switchedOn: false, passwordSet: true, member: null });
  });

  it("keeps the password across a restart, in an owner-only file", async () => {
    const plugin = startPlugin(on);
    await plugin.call("cross-daemon.set-own-password", { password: "tower-password" });
    const restarted = startPlugin(on, [], Promise.resolve(plugin.stateDir));
    await expect(restarted.call("cross-daemon.describe")).resolves.toMatchObject({ member: { password: "tower-password" } });
    expect(statSync(join(plugin.stateDir, "own-password.json")).mode & 0o777).toBe(0o600);
  });

  it("stops sharing the password once it is cleared", async () => {
    const plugin = startPlugin(on);
    await plugin.call("cross-daemon.set-own-password", { password: "tower-password" });
    await expect(plugin.call("cross-daemon.set-own-password", { password: null })).resolves.toEqual({ passwordSet: false });
    await expect(plugin.call("cross-daemon.describe")).resolves.toEqual({ serverId: "srv_tower", switchedOn: true, passwordSet: false, member: tower });
  });

  it("stores a peer's password with it but never lists it", async () => {
    const plugin = startPlugin(on);
    const protectedMac = { ...mac, password: "mac-password" };
    await plugin.call("cross-daemon.set-peers", { peers: [protectedMac], answeredServerIds: ["srv_mac"] });
    expect(plugin.storedPeers()).toEqual([{ ...mac, sealedPassword: expect.any(Object) }]);
    expect(await plugin.passwordUsedFor("mac")).toBe("mac-password");
    await expect(plugin.call("cross-daemon.list-peers")).resolves.toEqual({ peers: [{ serverId: "srv_mac", name: "mac", password: "announced" }] });
  });
});

describe("a peer's password set on this daemon", () => {
  it("survives a sync that brings that peer without a password", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.settle();
    await expect(plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "typed-mac-password" })).resolves.toEqual({
      passwordSet: true,
    });
    await plugin.call("cross-daemon.set-peers", { peers: [mac], answeredServerIds: ["srv_mac"] });
    expect(plugin.storedPeers()).toEqual([mac]);
    expect(await plugin.passwordUsedFor("mac")).toBe("typed-mac-password");
  });

  it("gives way to the password the peer announces itself, which its owner keeps current", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.settle();
    await plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "typed-mac-password" });
    await plugin.call("cross-daemon.set-peers", { peers: [{ ...mac, password: "announced-mac-password" }], answeredServerIds: ["srv_mac"] });
    expect(await plugin.passwordUsedFor("mac")).toBe("announced-mac-password");
  });

  it("is kept out of peers.json, across a restart, in an owner-only file", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.settle();
    await plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "typed-mac-password" });
    expect(plugin.storedPeers()).toEqual([mac]);
    const restarted = startPlugin(on, [mac], Promise.resolve(plugin.stateDir));
    await restarted.settle();
    expect(await restarted.passwordUsedFor("mac")).toBe("typed-mac-password");
    expect(statSync(join(plugin.stateDir, "peer-passwords.json")).mode & 0o777).toBe(0o600);
  });

  it("is forgotten when cleared", async () => {
    const plugin = startPlugin(on, [mac]);
    await plugin.settle();
    await plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "typed-mac-password" });
    await expect(plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: null })).resolves.toEqual({ passwordSet: false });
    expect(await plugin.passwordUsedFor("mac")).toBeUndefined();
  });

  it("is listed only as where the peer's password comes from, never as the password", async () => {
    const plugin = startPlugin(on, [mac, { ...tower, serverId: "srv_brs", name: "brs", password: "announced" }]);
    await plugin.settle();
    await plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "typed-mac-password" });
    await expect(plugin.call("cross-daemon.list-peers")).resolves.toEqual({
      peers: [
        { serverId: "srv_mac", name: "mac", password: "set-here" },
        { serverId: "srv_brs", name: "brs", password: "announced" },
      ],
    });
  });
});

function filesIn(dir: string): string {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

async function storeAllThreePasswords(plugin: ReturnType<typeof startPlugin>) {
  await plugin.settle();
  await plugin.call("cross-daemon.set-own-password", { password: "fake-tower-password" });
  await plugin.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "fake-typed-mac-password" });
  await plugin.call("cross-daemon.set-peers", { peers: [mac, { ...brs, password: "fake-brs-password" }], answeredServerIds: ["srv_mac", "srv_brs"] });
}

describe("passwords at rest", () => {
  it("seals every password it keeps, so none is on disk in plain text", async () => {
    const plugin = startPlugin(on);
    await storeAllThreePasswords(plugin);
    const onDisk = filesIn(plugin.stateDir);
    for (const password of ["fake-tower-password", "fake-typed-mac-password", "fake-brs-password"]) expect(onDisk).not.toContain(password);
    await expect(plugin.call("cross-daemon.describe")).resolves.toMatchObject({ member: { password: "fake-tower-password" } });
    expect(await plugin.passwordUsedFor("mac")).toBe("fake-typed-mac-password");
    expect(await plugin.passwordUsedFor("brs")).toBe("fake-brs-password");
  });

  it("seals the plain password files an older version left, when it starts", async () => {
    const stateDir = join(makeTempDir("cd-"), "cross-daemon");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "own-password.json"), JSON.stringify("fake-tower-password"));
    writeFileSync(join(stateDir, "peer-passwords.json"), JSON.stringify({ srv_mac: "fake-typed-mac-password" }));
    writeFileSync(join(stateDir, "peers.json"), JSON.stringify([mac, { ...brs, password: "fake-brs-password" }]));
    const plugin = startPlugin(on, [], Promise.resolve(stateDir));
    await plugin.settle();
    const onDisk = filesIn(stateDir);
    for (const password of ["fake-tower-password", "fake-typed-mac-password", "fake-brs-password"]) expect(onDisk).not.toContain(password);
    await expect(plugin.call("cross-daemon.describe")).resolves.toMatchObject({ passwordSet: true, member: { password: "fake-tower-password" } });
    expect(await plugin.passwordUsedFor("mac")).toBe("fake-typed-mac-password");
    expect(await plugin.passwordUsedFor("brs")).toBe("fake-brs-password");
  });

  it("names each password it can no longer open after Paseo makes a new daemon key, without showing it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = startPlugin(on);
    await storeAllThreePasswords(plugin);
    const restarted = startPlugin(on, [], Promise.resolve(plugin.stateDir), true, randomBytes(32));
    await restarted.settle();

    const logged = errors.mock.calls.flat().join("\n");
    expect(logged).toContain("this daemon's own password");
    expect(logged).toContain("Password for mac");
    expect(logged).toContain("brs gives it again at the next sync");
    for (const password of ["fake-tower-password", "fake-typed-mac-password", "fake-brs-password"]) expect(logged).not.toContain(password);
    await expect(restarted.call("cross-daemon.describe")).resolves.toEqual({
      serverId: "srv_tower",
      switchedOn: true,
      passwordSet: false,
      passwordUnreadable: true,
      member: tower,
    });
    await expect(restarted.call("cross-daemon.list-peers")).resolves.toEqual({
      peers: [
        { serverId: "srv_mac", name: "mac", password: "unreadable" },
        { serverId: "srv_brs", name: "brs", password: "none" },
      ],
    });
    expect(await restarted.passwordUsedFor("mac")).toBeUndefined();

    await restarted.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: "fake-new-mac-password" });
    expect(await restarted.passwordUsedFor("mac")).toBe("fake-new-mac-password");
  });

  it("gets a peer's own password back at the next sync after a key change", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = startPlugin(on);
    await storeAllThreePasswords(plugin);
    const restarted = startPlugin(on, [], Promise.resolve(plugin.stateDir), true, randomBytes(32));
    await restarted.settle();
    await restarted.call("cross-daemon.set-peers", { peers: [mac, { ...brs, password: "fake-brs-password" }], answeredServerIds: ["srv_mac", "srv_brs"] });
    expect(await restarted.passwordUsedFor("brs")).toBe("fake-brs-password");
  });

  it("keeps one peer's unreadable password while another's is set, and forgets it on request", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = startPlugin(on);
    await storeAllThreePasswords(plugin);
    const restarted = startPlugin(on, [], Promise.resolve(plugin.stateDir), true, randomBytes(32));
    await restarted.settle();
    await restarted.call("cross-daemon.set-peer-password", { serverId: "srv_brs", password: "fake-typed-brs-password" });
    await expect(restarted.call("cross-daemon.list-peers")).resolves.toMatchObject({ peers: [{ serverId: "srv_mac", password: "unreadable" }, {}] });
    await restarted.call("cross-daemon.set-peer-password", { serverId: "srv_mac", password: null });
    await expect(restarted.call("cross-daemon.list-peers")).resolves.toMatchObject({ peers: [{ serverId: "srv_mac", password: "none" }, {}] });
  });

  it("reports a damaged sealed password as unreadable instead of failing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const stateDir = join(makeTempDir("cd-"), "cross-daemon");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "peers.json"), JSON.stringify([mac]));
    writeFileSync(join(stateDir, "peer-passwords.json"), JSON.stringify({ srv_mac: { iv: "AAA=", tag: "AAA=", data: "AAA=" } }));
    const plugin = startPlugin(on, [], Promise.resolve(stateDir));
    await plugin.settle();
    expect(errors.mock.calls.flat().join("\n")).toContain("Password for mac");
    await expect(plugin.call("cross-daemon.list-peers")).resolves.toEqual({ peers: [{ serverId: "srv_mac", name: "mac", password: "unreadable" }] });
  });
});

describe("agent tools", () => {
  it("gives every new agent the cross-daemon tool server, reaching this plugin's socket", async () => {
    const plugin = startPlugin(off);
    const created = await plugin.createAgent({ provider: "claude", cwd: "/repo" });
    expect(created).toMatchObject({
      config: {
        mcpServers: {
          "cross-daemon": {
            command: process.execPath,
            args: [join(plugin.stateDir, "tool-proxy.cjs")],
          },
        },
      },
    });
  });

  it("still creates agents, without the tools, when the tool server cannot start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const plugin = startPlugin(off, [], Promise.reject(new Error("disk full")));
    const request = { config: { provider: "claude", cwd: "/repo" } };
    await expect(plugin.createAgent(request.config)).resolves.toEqual(request);
  });
});
