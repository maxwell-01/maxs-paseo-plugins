import { z } from "zod";
import type { Peer } from "../shared/cross-daemon.shared";
import type { PaseoCli, PaseoCliOptions } from "./paseo-cli.server";

const BUSY_STATUSES = new Set(["running", "initializing"]);
const inspectedAgentSchema = z.object({
  Id: z.string(),
  Status: z.string(),
  UpdatedAt: z.string(),
  Archived: z.boolean().default(false),
});

// Null means this daemon: a notice to the agent that sent a message.
export type Daemon = Peer | null;

export function runOn(cli: PaseoCli, daemon: Daemon, args: readonly string[], options?: PaseoCliOptions) {
  return daemon ? cli.run(daemon.link, args, options) : cli.runLocal(args, options);
}

export async function inspectAgent(cli: PaseoCli, daemon: Daemon, agentRef: string) {
  const inspected = inspectedAgentSchema.parse(JSON.parse(await runOn(cli, daemon, ["inspect", agentRef, "--json"])));
  if (inspected.Archived) throw new Error(`Agent ${inspected.Id} is archived`);
  return { id: inspected.Id, busy: BUSY_STATUSES.has(inspected.Status), updatedAt: inspected.UpdatedAt };
}
