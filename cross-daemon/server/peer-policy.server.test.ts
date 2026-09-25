import { describe, expect, it } from "vitest";
import { describeOwnDaemon, peersToStore } from "./peer-policy.server";

const own = { serverId: "srv_tower", name: "tower", link: "https://app.paseo.sh/#offer=tower" };
const mac = { serverId: "srv_mac", name: "mac", link: "https://app.paseo.sh/#offer=mac" };

describe("describeOwnDaemon", () => {
  it("shares the link of a switched-on daemon", () => {
    expect(describeOwnDaemon(own, true)).toEqual({ ...own, enabled: true });
  });

  it("withholds the link of a switched-off daemon so no peer can reach it", () => {
    expect(describeOwnDaemon(own, false)).toEqual({ ...own, enabled: false, link: null });
  });
});

describe("peersToStore", () => {
  it("stores the other daemons for a switched-on daemon", () => {
    expect(peersToStore({ enabled: true, ownServerId: "srv_tower", peers: [mac] })).toEqual([mac]);
  });

  it("never lists a daemon as its own peer", () => {
    expect(peersToStore({ enabled: true, ownServerId: "srv_tower", peers: [own, mac] })).toEqual([mac]);
  });

  it("stores no peers for a switched-off daemon", () => {
    expect(peersToStore({ enabled: false, ownServerId: "srv_tower", peers: [mac] })).toEqual([]);
  });
});
