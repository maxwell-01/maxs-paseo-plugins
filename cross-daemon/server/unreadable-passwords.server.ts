import type { PasswordStores } from "./password-stores.server";

const KEY_CHANGED = "Paseo's daemon key changed after it was saved";

// Names each password that can no longer be opened, never the password itself.
export function reportUnreadablePasswords({ ownPassword, peerPasswords, peers }: PasswordStores): void {
  if (ownPassword.isUnreadable()) {
    console.error(`cross-daemon: this daemon's own password can no longer be read: ${KEY_CHANGED}. Enter it again in This daemon → This daemon's password.`);
  }
  const names = new Map(peers.read().map((peer) => [peer.serverId, peer.name]));
  for (const serverId of peerPasswords.unreadableServerIds()) {
    const name = names.get(serverId) ?? serverId;
    console.error(`cross-daemon: the password set here for ${name} can no longer be read: ${KEY_CHANGED}. Enter it again in This daemon → Password for ${name}.`);
  }
  for (const peer of peers.withUnreadablePassword()) {
    console.error(`cross-daemon: the password ${peer.name} gives can no longer be read: ${KEY_CHANGED}. ${peer.name} gives it again at the next sync.`);
  }
}
