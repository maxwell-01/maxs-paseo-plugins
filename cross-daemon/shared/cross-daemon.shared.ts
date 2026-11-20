import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const crossDaemonSettings = defineSettings({
  id: "cross-daemon",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(false),
    // For each peer with no entry in peerAccess. "allowed" keeps links made before per-peer access working.
    defaultPeerAccess: z.enum(["allowed", "blocked"]).default("allowed"),
    // A direction left unset follows defaultPeerAccess.
    peerAccess: z.record(z.string(), z.object({ inbound: z.boolean().optional(), outbound: z.boolean().optional() })).default({}),
  }),
});
export type CrossDaemonSettings = z.output<typeof crossDaemonSettings.schema>;

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
  output: z.object({
    serverId: z.string(),
    switchedOn: z.boolean(),
    passwordSet: z.boolean(),
    // Present when the password entered here was sealed under an earlier daemon key and must be entered again.
    passwordUnreadable: z.literal(true).optional(),
  }),
});

// This daemon's link, with its password if set, addressed to each of the given daemons that this
// daemon's own settings let reach it. Nothing while switched off or without a relay link.
export const grantAccess = defineRpc({
  name: "cross-daemon.grant-access",
  input: z.object({ to: z.array(z.string().min(1)) }),
  output: z.object({ grants: z.array(z.object({ to: z.string(), peer: peerSchema })) }),
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

// A password for one peer, entered on this daemon and kept across syncs. Null forgets it. It is never
// read back.
export const setPeerPassword = defineRpc({
  name: "cross-daemon.set-peer-password",
  input: z.object({ serverId: z.string().min(1), password: z.string().min(1).nullable() }),
  output: z.object({ passwordSet: z.boolean() }),
});

export const peerPasswordSource = z.enum(["announced", "set-here", "unreadable", "none"]);
export type PeerPasswordSource = z.infer<typeof peerPasswordSource>;

// Names, server IDs and where each password comes from: a peer's link and password never leave the daemon.
export const listPeers = defineRpc({
  name: "cross-daemon.list-peers",
  input: z.object({}),
  output: z.object({ peers: z.array(z.object({ serverId: z.string(), name: z.string(), password: peerPasswordSource })) }),
});
