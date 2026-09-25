import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const crossDaemonSettings = defineSettings({
  id: "cross-daemon",
  scope: "host",
  version: 1,
  schema: z.object({ enabled: z.boolean().default(false) }),
});

export const peerSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1),
  link: z.string().url(),
});
export type Peer = z.infer<typeof peerSchema>;

export const describeDaemon = defineRpc({
  name: "cross-daemon.describe",
  input: z.object({}),
  output: z.object({
    serverId: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    link: z.string().nullable(),
  }),
});

export const setPeers = defineRpc({
  name: "cross-daemon.set-peers",
  input: z.object({ peers: z.array(peerSchema) }),
  output: z.object({ stored: z.number() }),
});
