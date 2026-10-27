import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const crossDaemonSettings = defineSettings({
  id: "cross-daemon",
  scope: "host",
  version: 1,
  schema: z.object({ enabled: z.boolean().default(false) }),
});

const PAIRING_LINK = /^https:\/\/[^\s#]+#offer=[A-Za-z0-9_-]+={0,2}$/;

export const peerSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  link: z.string().regex(PAIRING_LINK, "not a Paseo pairing link"),
  // Set when the daemon requires a password over the relay. Used only for calls to this peer.
  password: z.string().min(1).optional(),
});
export type Peer = z.infer<typeof peerSchema>;

export const describeDaemon = defineRpc({
  name: "cross-daemon.describe",
  input: z.object({}),
  output: z.object({ serverId: z.string(), switchedOn: z.boolean(), passwordSet: z.boolean(), member: peerSchema.nullable() }),
});

// The password peers need to reach this daemon over the relay. Null forgets it. It is never read back
// except inside this daemon's own description.
export const setOwnPassword = defineRpc({
  name: "cross-daemon.set-own-password",
  input: z.object({ password: z.string().min(1).nullable() }),
  output: z.object({ passwordSet: z.boolean() }),
});

export const setPeers = defineRpc({
  name: "cross-daemon.set-peers",
  input: z.object({ peers: z.array(peerSchema), answeredServerIds: z.array(z.string()) }),
  output: z.object({ stored: z.number() }),
});

// Names and server IDs only: a peer's link never leaves the daemon.
export const listPeers = defineRpc({
  name: "cross-daemon.list-peers",
  input: z.object({}),
  output: z.object({ peers: z.array(z.object({ serverId: z.string(), name: z.string() })) }),
});
