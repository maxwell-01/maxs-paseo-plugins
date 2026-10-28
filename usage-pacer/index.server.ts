import { existsSync } from "node:fs";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { firstMateHome, guardFile } from "./server/guard-location.server";
import { runGuard } from "./server/guard-run.server";
import { createPacer } from "./server/pacer.server";

export default function contribute(server: PluginServerContext) {
  const guard = guardFile();
  if (!existsSync(guard)) {
    console.error(`usage-pacer: no usage guard at ${guard}, so turns are not paced`);
    return () => {};
  }
  const pacer = createPacer(() => runGuard({ guard, firstMateHome: firstMateHome(), log: console.error }));
  server.on("agent.turn_started", () => pacer.poke());
  return () => pacer.stop();
}
