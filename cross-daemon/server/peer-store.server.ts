import { join } from "node:path";
import { z } from "zod";
import { type Peer, peerSchema } from "../shared/cross-daemon.shared";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

export function createPeerStore(stateDir: string) {
  const peersFile = join(stateDir, "peers.json");
  return {
    read: (): Peer[] => readPrivateJson(peersFile, z.array(peerSchema), []),
    write: (peers: readonly Peer[]) => writePrivateJson(peersFile, peers),
  };
}
