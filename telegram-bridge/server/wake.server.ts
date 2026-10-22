import { once } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describeError } from "./describe-error.server";

const ATTEMPTS = 5;
const FIRST_RETRY_MS = 1000;
const CALL_TIMEOUT_MS = 10_000;

type Callable = (...args: unknown[]) => unknown;

function hasFunctions<Name extends string>(value: unknown, ...names: Name[]): value is Record<Name, Callable> {
  return typeof value === "object" && value !== null && names.every((name) => typeof Reflect.get(value, name) === "function");
}

// Paseo starts the plugin process from a script inside @getpaseo/server, so the daemon's own CLI resolves from there.
export async function callOwnRpc(home: string, pluginId: string, rpcName: string, signal: AbortSignal): Promise<void> {
  const cliPackage = createRequire(process.argv[1]).resolve("@getpaseo/cli/package.json");
  const helper: unknown = await import(pathToFileURL(join(dirname(cliPackage), "dist", "utils", "client.js")).href);
  if (!hasFunctions(helper, "connectToDaemon")) throw new Error("the Paseo CLI has no connectToDaemon");
  const client: unknown = await helper.connectToDaemon({ target: { kind: "instance", home }, timeout: CALL_TIMEOUT_MS });
  if (!hasFunctions(client, "close")) throw new Error("the Paseo CLI returned no daemon client");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]);
  try {
    if (!hasFunctions(client, "invokePluginRpc")) throw new Error("the Paseo CLI's daemon client cannot call a plugin");
    await Promise.race([
      client.invokePluginRpc(pluginId, rpcName, {}),
      once(deadline, "abort").then(() => Promise.reject(new Error("the daemon did not answer"))),
    ]);
  } finally {
    await client.close();
  }
}

interface WakeOptions {
  callOwnRpc(signal: AbortSignal): Promise<void>;
  isAwake(): boolean;
  signal: AbortSignal;
  log(line: string): void;
  retryDelayMs?: (attempt: number) => number;
}

// The plugin API hands a Paseo handle only to hook and RPC handlers. Calling the plugin's own RPC from a second
// connection gets one at start-up, rather than at the first agent turn on the daemon.
export async function wakeSelf({ callOwnRpc, isAwake, signal, log, retryDelayMs = (attempt) => FIRST_RETRY_MS * 2 ** (attempt - 1) }: WakeOptions) {
  let lastError: unknown;
  const isDone = () => isAwake() || signal.aborted;
  for (let attempt = 0; attempt < ATTEMPTS && !isDone(); attempt += 1) {
    if (attempt > 0) await sleep(retryDelayMs(attempt), undefined, { signal }).catch((error: unknown) => {
        if (!signal.aborted) throw error;
      });
    if (signal.aborted) return;
    try {
      await callOwnRpc(signal);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  if (!isDone()) log(`telegram-bridge: could not start at once (${describeError(lastError)}); it starts at the next agent turn on this daemon`);
}
