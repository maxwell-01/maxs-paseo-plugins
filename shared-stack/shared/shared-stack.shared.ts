import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const entry = z.object({
  daemon: z.string(),
  agentId: z.string(),
  agentTitle: z.string().nullable(),
  workspaceName: z.string(),
  branch: z.string().nullable(),
  joinedAt: z.string(),
});

export const stackQueueStatus = defineRpc({
  name: "shared-stack.status",
  input: z.object({}),
  output: z.object({
    daemon: z.string(),
    isHost: z.boolean(),
    sharedDir: z.string(),
    error: z.string().nullable(),
    holder: entry.extend({ grantedAt: z.string(), leaseUntil: z.string(), snapshotAt: z.string().nullable() }).nullable(),
    waiting: z.array(entry),
    host: z
      .object({ daemon: z.string(), heartbeatAt: z.string(), stackUrl: z.string().nullable(), appliedAt: z.string().nullable(), error: z.string().nullable() })
      .nullable(),
    events: z.array(z.object({ at: z.string(), text: z.string() })),
  }),
});

// Only for entries that belong to this daemon: the stack's holder releases, a waiter leaves.
export const stackQueueRelease = defineRpc({
  name: "shared-stack.release",
  input: z.object({ agentId: z.string() }),
  output: z.object({ ok: z.boolean() }),
});
