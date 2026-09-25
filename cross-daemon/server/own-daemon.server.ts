import { createRequire } from "node:module";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface OwnDaemon {
  serverId: string;
  name: string;
  link: string | null;
}

interface PaseoServerExports {
  getOrCreateServerId(paseoHome: string): string;
  generateLocalPairingOffer(args: { paseoHome: string; relayEnabled?: boolean; includeQr?: boolean }): Promise<{ url: string | null }>;
}

function isPaseoServerExports(value: unknown): value is PaseoServerExports {
  return (
    typeof value === "object" &&
    value !== null &&
    "getOrCreateServerId" in value &&
    typeof value.getOrCreateServerId === "function" &&
    "generateLocalPairingOffer" in value &&
    typeof value.generateLocalPairingOffer === "function"
  );
}

let paseoServer: Promise<PaseoServerExports> | undefined;

// Paseo starts the plugin process from a script inside @getpaseo/server, so the running daemon's own
// package resolves from there. The plugin API offers no pairing link, and the CLI is not always on PATH.
function loadPaseoServer(): Promise<PaseoServerExports> {
  paseoServer ??= (async () => {
    const entry = createRequire(process.argv[1]).resolve("@getpaseo/server");
    const exports: unknown = await import(pathToFileURL(entry).href);
    if (!isPaseoServerExports(exports)) throw new Error(`@getpaseo/server at ${entry} lacks the pairing exports`);
    return exports;
  })();
  return paseoServer;
}

export function paseoHome(): string {
  return process.env.PASEO_HOME ?? join(homedir(), ".paseo");
}

export async function readOwnServerId(): Promise<string> {
  return (await loadPaseoServer()).getOrCreateServerId(paseoHome());
}

export async function readOwnDaemon(relayEnabled: boolean | undefined): Promise<OwnDaemon> {
  const server = await loadPaseoServer();
  const offer = await server.generateLocalPairingOffer({ paseoHome: paseoHome(), relayEnabled, includeQr: false });
  return { serverId: await readOwnServerId(), name: hostname(), link: offer.url };
}
