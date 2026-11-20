import { describe, expect, it } from "vitest";
import { crossDaemonSettings } from "./cross-daemon.shared";
import { isPeerAllowed, withPeerAccess } from "./peer-access.shared";

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

describe("withPeerAccess", () => {
  it("sets one direction and leaves the other following the default", () => {
    const blockedByDefault = { ...defaults, defaultPeerAccess: "blocked" as const };
    const next = withPeerAccess(blockedByDefault, "srv_tower", "inbound", true);
    expect(next.peerAccess).toEqual({ srv_tower: { inbound: true } });
    expect(next.enabled).toBe(true);
    expect(isPeerAllowed({ ...next, defaultPeerAccess: "allowed" }, "srv_tower", "outbound")).toBe(true);
  });

  it("leaves other peers' choices, and this peer's other direction, alone", () => {
    const values = { ...defaults, peerAccess: { srv_mac: { inbound: false, outbound: true }, srv_tower: { inbound: false } } };
    expect(withPeerAccess(values, "srv_tower", "outbound", false).peerAccess).toEqual({
      srv_mac: { inbound: false, outbound: true },
      srv_tower: { inbound: false, outbound: false },
    });
  });
});

describe("cross-daemon settings", () => {
  it("reads a document saved before per-peer access as allowing every peer", () => {
    expect(crossDaemonSettings.schema.parse({ enabled: true })).toEqual({ enabled: true, defaultPeerAccess: "allowed", peerAccess: {} });
  });
});
