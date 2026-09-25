import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// The plugin API offers no data folder. Paseo starts the plugin process from a script inside
// @getpaseo/server.
export async function resolvePaseoHome(): Promise<string> {
  const requireFromDaemon = createRequire(process.argv[1]);
  const daemonControl: unknown = await import(pathToFileURL(requireFromDaemon.resolve("@getpaseo/server/daemon-control")).href);
  const resolveHome: unknown = Reflect.get(Object(daemonControl), "resolvePaseoHome");
  if (typeof resolveHome !== "function") throw new Error("@getpaseo/server/daemon-control lacks resolvePaseoHome");
  const home: unknown = resolveHome();
  if (typeof home !== "string") throw new Error("Paseo returned no home directory");
  return home;
}
