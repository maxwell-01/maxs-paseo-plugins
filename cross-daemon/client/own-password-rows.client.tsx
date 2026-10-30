import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsInput, type SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { describeDaemon, setOwnPassword } from "../shared/cross-daemon.shared";
import { requestPeerSync } from "./sync-scheduler.client";

const DESCRIPTION_KEY = ["cross-daemon", "describe"];

function describePassword(passwordSet: boolean | undefined, passwordUnreadable: boolean): string {
  if (passwordSet === undefined) return "Checking…";
  if (passwordSet) return "Set. Switched-on daemons use it to reach this one.";
  if (passwordUnreadable) return "Can no longer be read: Paseo's daemon key changed after it was saved. Enter it again.";
  return "Not set. Enter it if this daemon has a password, or other daemons cannot reach it.";
}

export function OwnPasswordRows() {
  const callDescribe = useRpc(describeDaemon);
  const callSetOwnPassword = useRpc(setOwnPassword);
  const queryClient = useQueryClient();
  const input = useRef<SettingsInputHandle>(null);
  const [typed, setTyped] = useState("");
  const description = useQuery({ queryKey: DESCRIPTION_KEY, queryFn: () => callDescribe({}) });
  const save = useMutation({
    mutationFn: (password: string | null) => callSetOwnPassword({ password }),
    onSuccess: () => {
      input.current?.replaceText("");
      setTyped("");
      void queryClient.invalidateQueries({ queryKey: DESCRIPTION_KEY });
      requestPeerSync();
    },
  });
  const passwordSet = description.data?.passwordSet;

  return (
    <>
      <SettingsInput
        ref={input}
        label="This daemon's password"
        hint={describePassword(passwordSet, description.data?.passwordUnreadable === true)}
        placeholder="Daemon password"
        secureTextEntry
        disabled={save.isPending}
        error={save.error?.message ?? description.error?.message ?? null}
        onChangeText={setTyped}
      />
      <SettingsAction label="Give this password to the other daemons" actionLabel="Save" disabled={typed === "" || save.isPending} onPress={() => save.mutate(typed)} />
      {passwordSet ? (
        <SettingsAction label="Stop giving a password" actionLabel="Forget" disabled={save.isPending} onPress={() => save.mutate(null)} />
      ) : null}
    </>
  );
}
