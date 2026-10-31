import { join } from "node:path";
import { z } from "zod";
import { type Peer, peerSchema } from "../shared/cross-daemon.shared";
import { type PasswordSealer, sealedPasswordSchema } from "./password-sealer.server";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

export const PEERS_FILE = "peers.json";

const storedPeerSchema = peerSchema.omit({ password: true }).extend({ sealedPassword: sealedPasswordSchema.optional() });
type StoredPeer = z.infer<typeof storedPeerSchema>;

export function createPeerStore(stateDir: string, sealer: PasswordSealer) {
  const peersFile = join(stateDir, PEERS_FILE);
  const readStored = () => readPrivateJson(peersFile, z.array(storedPeerSchema), []);
  const open = ({ sealedPassword, ...peer }: StoredPeer): { peer: Peer; unreadable: boolean } => {
    const password = sealedPassword && sealer.open(sealedPassword);
    return { peer: password ? { ...peer, password } : peer, unreadable: password === null };
  };
  const seal = ({ password, ...peer }: Peer): StoredPeer => (password ? { ...peer, sealedPassword: sealer.seal(password) } : peer);
  return {
    read: (): Peer[] => readStored().map((stored) => open(stored).peer),
    // Peers whose announced password was sealed under an earlier daemon key. Their next sync brings it again.
    withUnreadablePassword: (): Peer[] => readStored().map(open).filter(({ unreadable }) => unreadable).map(({ peer }) => peer),
    write: (peers: readonly Peer[]) => writePrivateJson(peersFile, peers.map(seal)),
  };
}
