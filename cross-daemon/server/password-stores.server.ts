import { createOwnPasswordStore } from "./own-password-store.server";
import { createPasswordSealer } from "./password-sealer.server";
import { createPeerPasswordStore } from "./peer-password-store.server";
import { createPeerStore } from "./peer-store.server";
import { sealPlainPasswords } from "./seal-plain-passwords.server";
import { reportUnreadablePasswords } from "./unreadable-passwords.server";

export function openPasswordStores(stateDir: string, daemonSecretKey: Uint8Array) {
  const sealer = createPasswordSealer(daemonSecretKey);
  const stores = {
    ownPassword: createOwnPasswordStore(stateDir, sealer),
    peerPasswords: createPeerPasswordStore(stateDir, sealer),
    peers: createPeerStore(stateDir, sealer),
  };
  sealPlainPasswords(stateDir, stores);
  reportUnreadablePasswords(stores);
  return stores;
}

export type PasswordStores = ReturnType<typeof openPasswordStores>;
