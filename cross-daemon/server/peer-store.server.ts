import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { type Peer, peerSchema } from "../shared/cross-daemon.shared";

const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIR = 0o700;

export interface PeerStore {
  read(): Peer[];
  write(peers: readonly Peer[]): void;
}

export function createPeerStore(stateDir: string): PeerStore {
  const peersFile = join(stateDir, "peers.json");
  return {
    read() {
      if (!existsSync(peersFile)) return [];
      return z.array(peerSchema).parse(JSON.parse(readFileSync(peersFile, "utf8")));
    },
    write(peers) {
      mkdirSync(stateDir, { recursive: true, mode: OWNER_ONLY_DIR });
      chmodSync(stateDir, OWNER_ONLY_DIR);
      const staging = `${peersFile}.tmp`;
      writeFileSync(staging, JSON.stringify(peers, null, 2), { mode: OWNER_ONLY_FILE });
      renameSync(staging, peersFile);
    },
  };
}
