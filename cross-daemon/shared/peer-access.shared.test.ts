import { describe, expect, it } from "vitest";
import { crossDaemonSettings } from "./cross-daemon.shared";
import { isPeerAllowed } from "./peer-access.shared";

const defaults = crossDaemonSettings.schema.parse({ enabled: true });

describe("isPeerAllowed", () => {
  it("allows every peer both ways by default, so links made before per-peer access keep working", () => {
    expect(isPeerAllowed(defaults, "srv_mac", "inbound")).toBe(true);
    expect(isPeerAllowed(defaults, "srv_mac", "outbound")).toBe(true);
  });

  it("blocks a peer with no choice of its own when other daemons are blocked", () => {
    const values = { ...defaults, defaultPeerAccess: "blocked" as const };
    expect(isPeerAllowed(values, "srv_brs", "inbound")).toBe(false);
    expect(isPeerAllowed(values, "srv_brs", "outbound")).toBe(false);
  });

  it("follows a peer's own choice in each direction over the default", () => {
    const values = { ...defaults, defaultPeerAccess: "blocked" as const, peerAccess: { srv_tower: { inbound: true, outbound: false } } };
    expect(isPeerAllowed(values, "srv_tower", "inbound")).toBe(true);
    expect(isPeerAllowed(values, "srv_tower", "outbound")).toBe(false);
  });
});

describe("cross-daemon settings", () => {
  it("reads a document saved before per-peer access as allowing every peer", () => {
    expect(crossDaemonSettings.schema.parse({ enabled: true })).toEqual({ enabled: true, defaultPeerAccess: "allowed", peerAccess: {} });
  });
});
