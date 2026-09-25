import { createRequire } from "node:module";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import type { Peer } from "../shared/cross-daemon.shared";

export interface PaseoDaemon {
  home: string;
  readOwnPeer(relayEnabled: boolean): Promise<Peer | null>;
}

type DaemonFunction = (...args: unknown[]) => unknown;

function hasFunctions<Name extends string>(value: unknown, ...names: Name[]): value is Record<Name, DaemonFunction> {
  return typeof value === "object" && value !== null && names.every((name) => typeof Reflect.get(value, name) === "function");
}

// Paseo starts the plugin process from a script inside @getpaseo/server, so the running daemon's own
// packages resolve from there. The plugin API offers no pairing link, and the CLI is not always on PATH.
async function importFromDaemon<Name extends string>(specifier: string, ...names: Name[]) {
  const exports: unknown = await import(pathToFileURL(createRequire(process.argv[1]).resolve(specifier)).href);
  if (!hasFunctions(exports, ...names)) throw new Error(`${specifier} lacks ${names.join(", ")}`);
  return exports;
}

export async function loadPaseoDaemon(): Promise<PaseoDaemon> {
  const [control, configuration, pairing, offers] = await Promise.all([
    importFromDaemon("@getpaseo/server/daemon-control", "resolvePaseoHome"),
    importFromDaemon("@getpaseo/server/configuration", "readPersistedConfig", "resolveConfigFromPersisted"),
    importFromDaemon("@getpaseo/server/pairing", "generateLocalPairingOffer"),
    importFromDaemon("@getpaseo/protocol/connection-offer", "parseConnectionOfferFromUrl"),
  ]);
  const home = control.resolvePaseoHome();
  if (typeof home !== "string") throw new Error("Paseo returned no home directory");
  return {
    home,
    async readOwnPeer(relayEnabled) {
      const persisted = configuration.readPersistedConfig(home, { defaultsIfMissing: true });
      const config = configuration.resolveConfigFromPersisted(home, persisted, { env: process.env });
      const offer = await pairing.generateLocalPairingOffer({
        paseoHome: home,
        relayEnabled,
        relayEndpoint: Reflect.get(Object(config), "relayEndpoint"),
        relayPublicEndpoint: Reflect.get(Object(config), "relayPublicEndpoint"),
        relayUseTls: Reflect.get(Object(config), "relayUseTls"),
        relayPublicUseTls: Reflect.get(Object(config), "relayPublicUseTls"),
        appBaseUrl: Reflect.get(Object(config), "appBaseUrl"),
        includeQr: false,
      });
      const link: unknown = Reflect.get(Object(offer), "url");
      if (typeof link !== "string" || link === "") return null;
      const serverId: unknown = Reflect.get(Object(offers.parseConnectionOfferFromUrl(link)), "serverId");
      if (typeof serverId !== "string") throw new Error("Paseo produced a pairing link it cannot parse");
      return { serverId, name: hostname(), link };
    },
  };
}
