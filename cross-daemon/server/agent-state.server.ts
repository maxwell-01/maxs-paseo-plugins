import { z } from "zod";
import { type Daemon, type PaseoCli, runJson } from "./paseo-cli.server";

const BUSY_STATUSES = new Set(["running", "initializing"]);
const inspectedAgentSchema = z.object({
  Id: z.string(),
  Status: z.string(),
  UpdatedAt: z.string(),
  Archived: z.boolean().default(false),
});

export async function inspectAgent(cli: PaseoCli, daemon: Daemon, agentRef: string) {
  const inspected = await runJson(cli, daemon, ["inspect", agentRef, "--json"], inspectedAgentSchema);
  if (inspected.Archived) throw new Error(`Agent ${inspected.Id} is archived`);
  return { id: inspected.Id, busy: BUSY_STATUSES.has(inspected.Status), updatedAt: inspected.UpdatedAt };
}
