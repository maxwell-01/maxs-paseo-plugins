import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type PasswordSealer, sealedPasswordSchema } from "./password-sealer.server";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

export const OWN_PASSWORD_FILE = "own-password.json";

// Paseo keeps only a hash of the daemon password, so the plugin keeps its own sealed copy to give its peers.
export function createOwnPasswordStore(stateDir: string, sealer: PasswordSealer) {
  const passwordFile = join(stateDir, OWN_PASSWORD_FILE);
  const readSealed = () => readPrivateJson(passwordFile, sealedPasswordSchema.nullable(), null);
  return {
    read: (): string | null => {
      const sealed = readSealed();
      return sealed && sealer.open(sealed);
    },
    isUnreadable: (): boolean => {
      const sealed = readSealed();
      return sealed !== null && sealer.open(sealed) === null;
    },
    write(password: string | null) {
      if (password !== null) writePrivateJson(passwordFile, sealer.seal(password));
      else if (existsSync(passwordFile)) rmSync(passwordFile);
    },
  };
}
