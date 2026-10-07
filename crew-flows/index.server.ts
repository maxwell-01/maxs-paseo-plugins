import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFlows } from "./server/flows.server";
import { listFlows } from "./shared/flows.shared";

const SOURCES = {
  roots: ["/workspace"],
  // The marketplace checkout is the copy update.sh keeps current, so it holds the briefs loop.py runs.
  skillDir: join(homedir(), ".claude/plugins/marketplaces/max-personal/claudeConfig/skills/ticket-loop"),
};

export default function contribute(server: PluginServerContext) {
  server.handle(listFlows, () => readFlows(SOURCES));
  return () => {};
}
