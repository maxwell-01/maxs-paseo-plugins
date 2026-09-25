import { describe, expect, it } from "vitest";
import { buildDaemonRows } from "./daemon-rows.client";

const host = (serverId: string, label: string, status: "online" | "offline" = "online") => ({ serverId, label, status });
const peer = (serverId: string, name: string) => ({ serverId, name });
const daemon = (serverId: string, switchedOn: boolean, peers: { serverId: string; name: string }[] = []) => ({ serverId, switchedOn, peers });

describe("buildDaemonRows", () => {
  it("lists every connected host with its switch and the daemons it can reach", () => {
    const rows = buildDaemonRows(
      [host("srv_tower", "unRaid"), host("srv_mac", "MacBook")],
      [daemon("srv_tower", true, [peer("srv_mac", "Maxwells-MacBook-Pro-2.local")]), daemon("srv_mac", false)],
    );
    expect(rows).toEqual([
      { serverId: "srv_tower", label: "unRaid", state: "on", detail: "Can reach: MacBook" },
      { serverId: "srv_mac", label: "MacBook", state: "off", detail: "Switched off: no other daemon can reach it." },
    ]);
  });

  it("names a peer the app is not connected to by its hostname", () => {
    const [row] = buildDaemonRows([host("srv_tower", "unRaid")], [daemon("srv_tower", true, [peer("srv_laptop", "laptop.local")])]);
    expect(row.detail).toBe("Can reach: laptop.local");
  });

  it("says when a switched-on daemon has no peers yet", () => {
    const [row] = buildDaemonRows([host("srv_tower", "unRaid")], [daemon("srv_tower", true)]);
    expect(row.detail).toBe("Can reach: none yet. Switch on at least one other daemon.");
  });

  it("marks a host without the plugin, which cannot be switched", () => {
    const [row] = buildDaemonRows([host("srv_phone", "Old laptop")], []);
    expect(row).toEqual({
      serverId: "srv_phone",
      label: "Old laptop",
      state: "unavailable",
      detail: "The cross-daemon plugin is not installed on this daemon.",
    });
  });

  it("marks a host that is offline", () => {
    const [row] = buildDaemonRows([host("srv_mac", "MacBook", "offline")], [daemon("srv_mac", true)]);
    expect(row.state).toBe("unavailable");
    expect(row.detail).toBe("Offline.");
  });
});
