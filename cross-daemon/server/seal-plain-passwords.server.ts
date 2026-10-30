import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { peerSchema } from "../shared/cross-daemon.shared";
import { OWN_PASSWORD_FILE } from "./own-password-store.server";
import { PEER_PASSWORDS_FILE } from "./peer-password-store.server";
import type { PasswordStores } from "./password-stores.server";
import { PEERS_FILE } from "./peer-store.server";
import { parseJsonOrUndefined } from "./private-json.server";

// Undefined unless the file holds the plain form that versions before 0.10.0 wrote.
function readPlain<Schema extends z.ZodType>(file: string, schema: Schema): z.output<Schema> | undefined {
  if (!existsSync(file)) return undefined;
  const parsed = schema.safeParse(parseJsonOrUndefined(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : undefined;
}

// Each file is replaced whole, so its plain form does not stay on disk beside the sealed one.
export function sealPlainPasswords(stateDir: string, { ownPassword, peerPasswords, peers }: PasswordStores): void {
  const own = readPlain(join(stateDir, OWN_PASSWORD_FILE), z.string().min(1));
  if (own !== undefined) ownPassword.write(own);
  const setHere = readPlain(join(stateDir, PEER_PASSWORDS_FILE), z.record(z.string(), z.string().min(1)));
  if (setHere !== undefined) peerPasswords.replace(setHere);
  // Strict, so a sealed peer, which has no plain password key, is not read as a plain one.
  const plainPeers = readPlain(join(stateDir, PEERS_FILE), z.array(peerSchema.strict()));
  if (plainPeers?.some((peer) => peer.password)) peers.write(plainPeers);
}
