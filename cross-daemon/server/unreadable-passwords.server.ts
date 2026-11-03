import type { PasswordStores } from "./password-stores.server";

const UNREADABLE_REASON = "it was sealed under an earlier Paseo daemon key, or is damaged";

// Names each password that can no longer be opened, never the password itself.
export function reportUnreadablePasswords({ ownPassword, peerPasswords, peers }: PasswordStores): void {
  if (ownPassword.isUnreadable()) {
    console.error(`cross-daemon: this daemon's own password can no longer be read: ${UNREADABLE_REASON}. Enter it again in This daemon → This daemon's password.`);
  }
  const names = new Map(peers.read().map((peer) => [peer.serverId, peer.name]));
  for (const serverId of peerPasswords.unreadableServerIds()) {
    const name = names.get(serverId) ?? serverId;
    console.error(`cross-daemon: the password set here for ${name} can no longer be read: ${UNREADABLE_REASON}. Enter it again in This daemon → Password for ${name}.`);
  }
  for (const peer of peers.withUnreadablePassword()) {
    console.error(`cross-daemon: the password ${peer.name} gives can no longer be read: ${UNREADABLE_REASON}. ${peer.name} gives it again at the next sync.`);
  }
}
