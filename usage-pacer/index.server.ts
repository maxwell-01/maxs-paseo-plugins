import { existsSync } from "node:fs";
import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { firstMateHome, guardFile, pacingOverridesFile } from "./server/guard-location.server";
import { runGuard } from "./server/guard-run.server";
import { pacingDefaultsFrom, writePacingOverrides } from "./server/pacing-overrides.server";
import { createPacer } from "./server/pacer.server";
import { pacingSettings, readPacingDefaults } from "./shared/pacing.shared";

export default function contribute(server: PluginServerContext) {
  const guard = guardFile();
  const settings = server.registerSettings(pacingSettings);
  server.handle(readPacingDefaults, () => pacingDefaultsFrom(guard));
  if (!existsSync(guard)) {
    console.error(`usage-pacer: no usage guard at ${guard}, so turns are not paced`);
    return () => {};
  }
  const overridesFile = pacingOverridesFile();
  const handToGuard = async (state: PluginSettingsState<typeof pacingSettings.schema>) => {
    if (state.status === "invalid") {
      console.error(`usage-pacer: saved pacing settings are invalid, so the guard keeps the last ones: ${state.error}`);
      return;
    }
    await writePacingOverrides(overridesFile, state.values);
  };
  let savedSinceStart = false;
  const stopWatchingSettings = settings.subscribe((state) => {
    savedSinceStart = true;
    return handToGuard(state);
  });
  settings
    .read()
    .then((state) => (savedSinceStart ? undefined : handToGuard(state)))
    .catch((error: unknown) => console.error(`usage-pacer: could not hand pacing settings to ${overridesFile}`, error));
  const pacer = createPacer(() => runGuard({ guard, firstMateHome: firstMateHome(), log: console.error }));
  server.on("agent.turn_started", () => pacer.poke());
  return () => {
    stopWatchingSettings();
    pacer.stop();
  };
}
