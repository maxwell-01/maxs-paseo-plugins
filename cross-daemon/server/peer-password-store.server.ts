import { join } from "node:path";
import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

// Passwords entered on this daemon for its peers, by server ID. Kept apart from peers.json, which
// every sync rewrites, so a sync never drops one.
export function createPeerPasswordStore(stateDir: string) {
  const passwordsFile = join(stateDir, "peer-passwords.json");
  const read = (): Record<string, string> => readPrivateJson(passwordsFile, z.record(z.string(), z.string().min(1)), {});
  return {
    read,
    write(serverId: string, password: string | null) {
      const { [serverId]: _replaced, ...others } = read();
      writePrivateJson(passwordsFile, password === null ? others : { ...others, [serverId]: password });
    },
  };
}

// A password the peer announces itself wins: its owner keeps it current on that daemon.
export function withPeerPasswords(peers: readonly Peer[], passwordsSetHere: Readonly<Record<string, string>>): Peer[] {
  return peers.map((peer) => {
    const setHere = passwordsSetHere[peer.serverId];
    return peer.password || !setHere ? peer : { ...peer, password: setHere };
  });
}
