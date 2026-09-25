import { describe, expect, it } from "vitest";
import type { Peer } from "../shared/cross-daemon.shared";
import { type DaemonPort, syncPeers } from "./peer-sync.client";

type Description = { serverId: string; name: string; enabled: boolean; link: string | null };

function fakeDaemon(description: Description | Error) {
  const received: Peer[][] = [];
  const port: DaemonPort = {
    async describe() {
      if (description instanceof Error) throw description;
      return description;
    },
    async setPeers(peers) {
      received.push(peers);
    },
  };
  return { port, received };
}

const on = (name: string) => ({ serverId: `srv_${name}`, name, enabled: true, link: `https://app.paseo.sh/#offer=${name}` });
const peer = (name: string) => ({ serverId: `srv_${name}`, name, link: `https://app.paseo.sh/#offer=${name}` });

describe("syncPeers", () => {
  it("gives each switched-on daemon the other switched-on daemons", async () => {
    const tower = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    const laptop = fakeDaemon(on("laptop"));
    await syncPeers([tower.port, mac.port, laptop.port]);
    expect(tower.received).toEqual([[peer("mac"), peer("laptop")]]);
    expect(mac.received).toEqual([[peer("tower"), peer("laptop")]]);
  });

  it("leaves a switched-off daemon out of every list and gives it no peers", async () => {
    const tower = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    const lonely = fakeDaemon({ serverId: "srv_lonely", name: "lonely", enabled: false, link: null });
    await syncPeers([tower.port, mac.port, lonely.port]);
    expect(tower.received).toEqual([[peer("mac")]]);
    expect(lonely.received).toEqual([[]]);
  });

  it("leaves out a switched-on daemon with no link, such as one with the relay off", async () => {
    const tower = fakeDaemon(on("tower"));
    const noRelay = fakeDaemon({ serverId: "srv_norelay", name: "norelay", enabled: true, link: null });
    await syncPeers([tower.port, noRelay.port]);
    expect(tower.received).toEqual([[]]);
  });

  it("skips a daemon that cannot be reached and still syncs the rest", async () => {
    const tower = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    const offline = fakeDaemon(new Error("Plugin host is offline"));
    await syncPeers([tower.port, mac.port, offline.port]);
    expect(tower.received).toEqual([[peer("mac")]]);
    expect(offline.received).toEqual([]);
  });

  it("syncs a daemon registered twice only once", async () => {
    const tower = fakeDaemon(on("tower"));
    const towerAgain = fakeDaemon(on("tower"));
    const mac = fakeDaemon(on("mac"));
    await syncPeers([tower.port, towerAgain.port, mac.port]);
    expect(mac.received).toEqual([[peer("tower")]]);
    expect(towerAgain.received).toEqual([]);
  });
});
