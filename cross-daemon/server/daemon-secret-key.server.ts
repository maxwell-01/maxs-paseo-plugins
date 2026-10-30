import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const daemonKeyPairSchema = z.object({ v: z.literal(2), secretKeyB64: z.string().min(1) });

// The secret half of the key Paseo keeps for the relay. The plugin seals its passwords with a key
// derived from it, so they are not stored in plain text.
export function readDaemonSecretKey(paseoHome: string): Buffer {
  const file = join(paseoHome, "daemon-keypair.json");
  try {
    return Buffer.from(daemonKeyPairSchema.parse(JSON.parse(readFileSync(file, "utf8"))).secretKeyB64, "base64");
  } catch (error) {
    throw new Error(`cross-daemon: cannot read Paseo's daemon key from ${file}`, { cause: error });
  }
}
