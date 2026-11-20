import { describe, expect, it } from "vitest";
import { crossDaemonSettings } from "../shared/cross-daemon.shared";
import { buildPeerAccessRows } from "./peer-access-rows.client";

const host = (serverId: string, label: string) => ({ serverId, label, status: "online" as const });
const settings = (values: object = {}) => crossDaemonSettings.schema.parse({ enabled: true, ...values });

describe("buildPeerAccessRows", () => {
  it("lists every other connected daemon with both directions, allowed by default", () => {
    const rows = buildPeerAccessRows({
      ownServerId: "srv_rescue",
      hosts: [host("srv_rescue", "Rescue"), host("srv_tower", "unRaid"), host("srv_brs", "scram-brs")],
      storedPeers: [],
      daemons: [],
      settings: settings(),
    });
    expect(rows).toEqual([
      { serverId: "srv_tower", label: "unRaid", inbound: true, outbound: true, stillHoldsLink: false },
      { serverId: "srv_brs", label: "scram-brs", inbound: true, outbound: true, stillHoldsLink: false },
    ]);
  });

  it("shows each peer's own choice over the default", () => {
    const [tower, brs] = buildPeerAccessRows({
      ownServerId: "srv_rescue",
      hosts: [host("srv_tower", "unRaid"), host("srv_brs", "scram-brs")],
      storedPeers: [],
      daemons: [],
      settings: settings({ defaultPeerAccess: "blocked", peerAccess: { srv_tower: { inbound: true, outbound: true } } }),
    });
    expect(tower).toMatchObject({ inbound: true, outbound: true });
    expect(brs).toMatchObject({ inbound: false, outbound: false });
  });

  it("adds a stored peer the app is not connected to, by its hostname", () => {
    const rows = buildPeerAccessRows({
      ownServerId: "srv_rescue",
      hosts: [],
      storedPeers: [{ serverId: "srv_laptop", name: "laptop.local" }],
      daemons: [],
      settings: settings(),
    });
    expect(rows).toEqual([{ serverId: "srv_laptop", label: "laptop.local", inbound: true, outbound: true, stillHoldsLink: false }]);
  });

  it("flags a blocked peer that still lists this daemon, so its link may need changing", () => {
    const [brs] = buildPeerAccessRows({
      ownServerId: "srv_rescue",
      hosts: [host("srv_brs", "scram-brs")],
      storedPeers: [],
      daemons: [{ serverId: "srv_brs", peers: [{ serverId: "srv_rescue" }] }],
      settings: settings({ peerAccess: { srv_brs: { inbound: false } } }),
    });
    expect(brs).toMatchObject({ inbound: false, stillHoldsLink: true });
  });

  it("does not flag an allowed peer that lists this daemon", () => {
    const [tower] = buildPeerAccessRows({
      ownServerId: "srv_rescue",
      hosts: [host("srv_tower", "unRaid")],
      storedPeers: [],
      daemons: [{ serverId: "srv_tower", peers: [{ serverId: "srv_rescue" }] }],
      settings: settings(),
    });
    expect(tower.stillHoldsLink).toBe(false);
  });
});
