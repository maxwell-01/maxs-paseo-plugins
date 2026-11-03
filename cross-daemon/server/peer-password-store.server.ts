import { join } from "node:path";
import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import { type PasswordSealer, sealedPasswordSchema } from "./password-sealer.server";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

export const PEER_PASSWORDS_FILE = "peer-passwords.json";

// Passwords entered on this daemon for its peers, sealed, by server ID. Kept apart from peers.json,
// which every sync rewrites, so a sync never drops one.
export function createPeerPasswordStore(stateDir: string, sealer: PasswordSealer) {
  const passwordsFile = join(stateDir, PEER_PASSWORDS_FILE);
  const readSealed = () => readPrivateJson(passwordsFile, z.record(z.string(), sealedPasswordSchema), {});
  const opened = () => Object.entries(readSealed()).map(([serverId, sealed]) => [serverId, sealer.open(sealed)] as const);
  const replace = (passwords: Readonly<Record<string, string>>) =>
    writePrivateJson(passwordsFile, Object.fromEntries(Object.entries(passwords).map(([serverId, password]) => [serverId, sealer.seal(password)])));
  return {
    read: (): Record<string, string> =>
      Object.fromEntries(opened().filter((entry): entry is readonly [string, string] => entry[1] !== null)),
    unreadableServerIds: (): string[] => opened().filter(([, password]) => password === null).map(([serverId]) => serverId),
    replace,
    write(serverId: string, password: string | null) {
      const { [serverId]: _replaced, ...others } = readSealed();
      writePrivateJson(passwordsFile, password === null ? others : { ...others, [serverId]: sealer.seal(password) });
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
