import { afterEach, describe, expect, it, vi } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import { type DaemonDescription, type DaemonPort, type PeerUpdate, syncPeers } from "./peer-sync.client";

function fakeDaemon(description: DaemonDescription | Error) {
  const received: PeerUpdate[] = [];
  const port: DaemonPort = {
    async describe() {
      if (description instanceof Error) throw description;
      return description;
    },
    async setPeers(update) {
      received.push(update);
    },
  };
  return { port, received };
}

const peer = (name: string): Peer => ({ serverId: `srv_${name}`, name, link: `https://app.paseo.sh/#offer=${name}` });
const on = (name: string): DaemonDescription => ({ serverId: `srv_${name}`, member: peer(name) });
const off = (name: string): DaemonDescription => ({ serverId: `srv_${name}`, member: null });

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

  it("leaves a switched-off daemon out of every list, and says it answered so its old link is dropped", async () => {
    const tower = fakeDaemon(on("tower"));
    const lonely = fakeDaemon(off("lonely"));
    await syncPeers([tower.port, lonely.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower", "srv_lonely"] }]);
  });

  it("leaves out a daemon with no link, such as one with the relay off", async () => {
    const tower = fakeDaemon(on("tower"));
    const noRelay = fakeDaemon({ serverId: null, member: null });
    await syncPeers([tower.port, noRelay.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower"] }]);
  });

  it("does not count a daemon that failed to answer, so its peers keep its link", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tower = fakeDaemon(on("tower"));
    const asleep = fakeDaemon(new Error("Plugin host is offline"));
    await syncPeers([tower.port, asleep.port]);
    expect(tower.received).toEqual([{ peers: [], answeredServerIds: ["srv_tower"] }]);
    expect(asleep.received).toEqual([]);
  });

  it("reports a daemon that failed to answer instead of dropping the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await syncPeers([fakeDaemon(new Error("Plugin host is offline")).port]);
    expect(warn).toHaveBeenCalledWith("cross-daemon: a host did not answer the peer sync", expect.any(Error));
  });
});
