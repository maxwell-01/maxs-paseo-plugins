import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, type SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type PeerPasswordSource, setPeerPassword } from "../shared/cross-daemon.shared";

interface PeerPasswordTarget {
  serverId: string;
  name: string;
  password: PeerPasswordSource;
}

function describePeerPassword(name: string, source: PeerPasswordSource): string {
  if (source === "set-here") return `Set on this daemon. Kept until you forget it, even if ${name} does not give one.`;
  if (source === "unreadable") return `Can no longer be read: it was sealed under an earlier Paseo daemon key, or is damaged. Enter the password for ${name} again.`;
  return `Not set. Enter it if ${name} has a password and does not give it, or calls to it fail with "Password required".`;
}

// A peer that announces its own password needs no row: its announced password wins.
export function PeerPasswordRows({ peers, onSaved }: { peers: readonly PeerPasswordTarget[]; onSaved(): void }) {
  return (
    <>
      {peers
        .filter((peer) => peer.password !== "announced")
        .map((peer) => (
          <PeerPasswordRow key={peer.serverId} peer={peer} onSaved={onSaved} />
        ))}
    </>
  );
}

function PeerPasswordRow({ peer, onSaved }: { peer: PeerPasswordTarget; onSaved(): void }) {
  const callSetPeerPassword = useRpc(setPeerPassword);
  const input = useRef<SettingsInputHandle>(null);
  const [typed, setTyped] = useState("");
  const save = useMutation({
    mutationFn: (password: string | null) => callSetPeerPassword({ serverId: peer.serverId, password }),
    onSuccess: () => {
      input.current?.replaceText("");
      setTyped("");
      onSaved();
    },
  });

  return (
    <>
      <SettingsInput
        ref={input}
        label={`Password for ${peer.name}`}
        hint={describePeerPassword(peer.name, peer.password)}
        placeholder={`${peer.name}'s daemon password`}
        secureTextEntry
        disabled={save.isPending}
        error={save.error?.message ?? null}
        onChangeText={setTyped}
      />
      <SettingsAction label={`Use this password for ${peer.name}`} actionLabel="Save" disabled={typed === "" || save.isPending} onPress={() => save.mutate(typed)} />
      {peer.password === "set-here" || peer.password === "unreadable" ? (
        <SettingsAction label={`Forget the password for ${peer.name}`} actionLabel="Forget" disabled={save.isPending} onPress={() => save.mutate(null)} />
      ) : null}
    </>
  );
}
