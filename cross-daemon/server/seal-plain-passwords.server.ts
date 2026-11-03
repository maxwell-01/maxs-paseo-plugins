import { join } from "node:path";
import { z } from "zod";
import { peerSchema } from "../shared/cross-daemon.shared";
import { OWN_PASSWORD_FILE } from "./own-password-store.server";
import { PEER_PASSWORDS_FILE } from "./peer-password-store.server";
import type { PasswordStores } from "./password-stores.server";
import { PEERS_FILE } from "./peer-store.server";
import { readPrivateJsonIfValid } from "./private-json.server";

// Versions before 0.10.0 wrote these files in plain text. Each is replaced whole, so its plain form
// does not stay on disk beside the sealed one.
export function sealPlainPasswords(stateDir: string, { ownPassword, peerPasswords, peers }: PasswordStores): void {
  const own = readPrivateJsonIfValid(join(stateDir, OWN_PASSWORD_FILE), z.string().min(1));
  if (own !== undefined) ownPassword.write(own);
  const setHere = readPrivateJsonIfValid(join(stateDir, PEER_PASSWORDS_FILE), z.record(z.string(), z.string().min(1)));
  if (setHere !== undefined) peerPasswords.replace(setHere);
  // Strict, so a sealed peer, which has no plain password key, is not read as a plain one.
  const plainPeers = readPrivateJsonIfValid(join(stateDir, PEERS_FILE), z.array(peerSchema.strict()));
  if (plainPeers?.some((peer) => peer.password)) peers.write(plainPeers);
}
