import { describe, expect, it } from "vitest";
import { buildDaemonRows } from "./daemon-rows.client";

const host = (serverId: string, label: string, status: "online" | "offline" = "online") => ({ serverId, label, status });
const peer = (serverId: string, name: string) => ({ serverId, name });
const daemon = (serverId: string, switchedOn: boolean, peers: { serverId: string; name: string }[] = []) => ({ serverId, switchedOn, peers });

describe("buildDaemonRows", () => {
  it("lists every connected host with its switch and the daemons it can reach", () => {
    const rows = buildDaemonRows([host("srv_tower", "unRaid"), host("srv_mac", "MacBook")], {
      daemons: [daemon("srv_tower", true, [peer("srv_mac", "Maxwells-MacBook-Pro-2.local")]), daemon("srv_mac", false)],
      failedCount: 0,
    });
    expect(rows).toEqual([
      { serverId: "srv_tower", label: "unRaid", state: "on", detail: "Can reach: MacBook" },
      { serverId: "srv_mac", label: "MacBook", state: "off", detail: "Switched off: no other daemon can reach it." },
    ]);
  });

  it("names a peer the app is not connected to by its hostname", () => {
    const [row] = buildDaemonRows([host("srv_tower", "unRaid")], { daemons: [daemon("srv_tower", true, [peer("srv_laptop", "laptop.local")])], failedCount: 0 });
    expect(row.detail).toBe("Can reach: laptop.local");
  });

  it("says when a switched-on daemon has no peers yet", () => {
    const [row] = buildDaemonRows([host("srv_tower", "unRaid")], { daemons: [daemon("srv_tower", true)], failedCount: 0 });
    expect(row.detail).toBe("Can reach: none yet. Switch on at least one other daemon.");
  });

  it("marks a host without the plugin, which cannot be switched", () => {
    const [row] = buildDaemonRows([host("srv_phone", "Old laptop")], { daemons: [], failedCount: 0 });
    expect(row).toEqual({
      serverId: "srv_phone",
      label: "Old laptop",
      state: "unavailable",
      detail: "The cross-daemon plugin is not installed on this daemon.",
    });
  });

  it("says it is checking while the daemons have not answered yet", () => {
    const [row] = buildDaemonRows([host("srv_mac", "MacBook")], null);
    expect(row).toEqual({ serverId: "srv_mac", label: "MacBook", state: "unavailable", detail: "Checking…" });
  });

  it("does not claim the plugin is missing when a daemon failed to answer", () => {
    const [row] = buildDaemonRows([host("srv_mac", "MacBook")], { daemons: [], failedCount: 1 });
    expect(row.detail).toBe("Could not read this daemon. It may be slow, or its plugin may be older.");
  });

  it("marks a host that is offline", () => {
    const [row] = buildDaemonRows([host("srv_mac", "MacBook", "offline")], { daemons: [daemon("srv_mac", true)], failedCount: 0 });
    expect(row.state).toBe("unavailable");
    expect(row.detail).toBe("Offline.");
  });
});
