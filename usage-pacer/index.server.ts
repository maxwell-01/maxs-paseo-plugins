import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { installGuard } from "./server/guard-install.server";
import { guardFile, pacingOverridesFile, stateDir } from "./server/guard-location.server";
import { type GuardMode, runGuard } from "./server/guard-run.server";
import { pacingDefaultsFrom, writePacingOverrides } from "./server/pacing-overrides.server";
import { createPacer } from "./server/pacer.server";
import { pacingSettings, readPacingDefaults } from "./shared/pacing.shared";

const WATCH_EVERY_MS = 3 * 60_000;

export default function contribute(server: PluginServerContext) {
  const guard = guardFile();
  const installed = installGuard(stateDir());
  installed.catch((error: unknown) => console.error(`usage-pacer: could not install the usage guard at ${guard}`, error));
  const settings = server.registerSettings(pacingSettings);
  server.handle(readPacingDefaults, () => pacingDefaultsFrom());
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
  const pacerFor = (mode: GuardMode) =>
    createPacer(async () => {
      await installed;
      await runGuard({ guard, mode, log: console.error });
    });
  const turnPacer = pacerFor("bootstrap");
  const watchPacer = pacerFor("watch");
  server.on("agent.turn_started", () => turnPacer.poke());
  const watchTimer = setInterval(() => watchPacer.poke(), WATCH_EVERY_MS);
  return () => {
    stopWatchingSettings();
    clearInterval(watchTimer);
    turnPacer.stop();
    watchPacer.stop();
  };
}
