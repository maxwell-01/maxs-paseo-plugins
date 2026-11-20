import { afterEach, describe, expect, it, vi } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createDaemonPort, type DaemonDescription, type DaemonPort, type PeerUpdate, syncPeers } from "./peer-sync.client";

interface FakeDaemon {
  description: DaemonDescription | Error;
  // This daemon's link, given to every daemon asked for unless blocked. Null: switched off or no relay.
  member: Peer | null;
  blocks?: string[];
  grantFails?: boolean;
}

function fakeDaemon({ description, member, blocks = [], grantFails = false }: FakeDaemon) {
  const received: PeerUpdate[] = [];
  const port: DaemonPort = {
    async describe() {
      if (description instanceof Error) throw description;
      return description;
    },
    async grantAccess(to) {
      if (grantFails) throw new Error("grant-access is not a plugin RPC on this host");
      return member ? to.filter((serverId) => !blocks.includes(serverId)).map((serverId) => ({ to: serverId, peer: member })) : [];
    },
    async setPeers(update) {
      received.push(update);
    },
    listPeers: async () => [],
    setSwitch: async () => {},
  };
  return { port, received };
}

const peer = (name: string): Peer => ({ serverId: `srv_${name}`, name, link: `https://app.paseo.sh/#offer=${name}` });
const described = (name: string, switchedOn: boolean): DaemonDescription => ({ serverId: `srv_${name}`, switchedOn, passwordSet: false });
const on = (name: string, options: Partial<FakeDaemon> = {}): FakeDaemon => ({ description: described(name, true), member: peer(name), ...options });
const off = (name: string): FakeDaemon => ({ description: described(name, false), member: null });

describe("syncPeers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives each switched-on daemon the other switched-on daemons", async () => {
    const tower = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    const laptop = fakeDaemon(on("laptop"));
    await syncPeers([tower.port, mac.port, laptop.port]);
    expect(tower.received[0].peers).toEqual([peer("mac"), peer("laptop")]);
    expect(mac.received[0].peers).toEqual([peer("tower"), peer("laptop")]);
  });

  it("gives a password-protected daemon's password only to the daemons that call it", async () => {
    const protectedTower = { ...peer("tower"), password: "tower-password" };
    const tower = fakeDaemon({ description: { ...described("tower", true), passwordSet: true }, member: protectedTower });
    const mac = fakeDaemon(on("mac"));
    await syncPeers([tower.port, mac.port]);
    expect(mac.received[0].peers).toEqual([protectedTower]);
    expect(tower.received[0].peers).toEqual([peer("mac")]);
  });

  it("leaves a switched-off daemon out of every list, and says it answered so its old link is dropped", async () => {
    const tower = fakeDaemon(on("tower"));
    const lonely = fakeDaemon(off("lonely"));
    await syncPeers([tower.port, lonely.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower", "srv_lonely"] }]);
  });

  it("leaves out a daemon with no link, such as one with the relay off", async () => {
    const tower = fakeDaemon(on("tower"));
    const noRelay = fakeDaemon({ description: described("norelay", true), member: null });
    await syncPeers([tower.port, noRelay.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower", "srv_norelay"] }]);
  });

  it("does not count a daemon that failed to answer, so its peers keep its link", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon(on("tower"));
    const asleep = fakeDaemon({ description: new Error("Plugin host is offline"), member: null });
    await syncPeers([tower.port, asleep.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower"] }]);
    expect(asleep.received).toEqual([]);
  });

  it("gives a daemon's link only to the daemons it grants, so the rest drop it", async () => {
    const rescue = fakeDaemon(on("rescue", { blocks: ["srv_brs"] }));
    const tower = fakeDaemon(on("tower"));
    const brs = fakeDaemon(on("brs"));
    await syncPeers([rescue.port, tower.port, brs.port]);
    expect(tower.received[0].peers).toEqual([peer("rescue"), peer("brs")]);
    expect(brs.received[0]).toEqual({ peers: [peer("tower")], answeredServerIds: ["srv_rescue", "srv_tower", "srv_brs"] });
  });

  it("does not count a daemon whose grants failed, so its peers keep its link until it answers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon(on("tower"));
    const flaky = fakeDaemon(on("flaky", { grantFails: true }));
    await syncPeers([tower.port, flaky.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower"] }]);
    expect(flaky.received).toEqual([{ peers: [peer("tower")], answeredServerIds: ["srv_tower"] }]);
  });

  it("gives no link to, or from, two daemons that claim the same server ID", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    const impostor = fakeDaemon(on("mac"));
    await syncPeers([tower.port, mac.port, impostor.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower"] }]);
    expect(mac.received).toEqual([]);
    expect(impostor.received).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("srv_mac"));
  });

  it("reports a daemon that failed to answer instead of dropping the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncPeers([fakeDaemon({ description: new Error("Plugin host is offline"), member: null }).port]);
    expect(warn).toHaveBeenCalledWith("cross-daemon: a host did not answer the peer sync", expect.any(Error));
  });
});

describe("createDaemonPort", () => {
  it("reports a switch that could not be saved instead of treating it as saved", async () => {
    const rpc = (async (contract: { name: string }) =>
      contract.name.endsWith(".read")
        ? { status: "ready", revision: "r1", values: { enabled: false } }
        : { status: "conflict", error: "the settings changed elsewhere" }) as unknown as PluginClientContext["rpc"];
    await expect(createDaemonPort(rpc).setSwitch(true)).rejects.toThrow("the settings changed elsewhere");
  });

  it("keeps the per-peer access choices when it flips the switch", async () => {
    const access = { defaultPeerAccess: "blocked", peerAccess: { srv_mac: { inbound: true, outbound: true } } };
    const written: unknown[] = [];
    const rpc = (async (contract: { name: string }, input: { values?: unknown }) => {
      if (contract.name.endsWith(".read")) return { status: "ready", revision: "r1", values: { enabled: false, ...access } };
      written.push(input.values);
      return { status: "saved", revision: "r2" };
    }) as unknown as PluginClientContext["rpc"];
    await createDaemonPort(rpc).setSwitch(true);
    expect(written).toEqual([{ enabled: true, ...access }]);
  });

  it("refuses to flip the switch over settings it cannot read, rather than reset them", async () => {
    const rpc = (async (contract: { name: string }) =>
      contract.name.endsWith(".read") ? { status: "invalid", revision: "r1", error: "schema version 9 is newer" } : { status: "saved" }) as unknown as PluginClientContext["rpc"];
    await expect(createDaemonPort(rpc).setSwitch(true)).rejects.toThrow("schema version 9 is newer");
  });
});
