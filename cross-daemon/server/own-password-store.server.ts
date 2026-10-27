import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateJson, writePrivateJson } from "./private-json.server";

// Paseo keeps only a hash of the daemon password, so the plugin keeps its own copy to give its peers.
export function createOwnPasswordStore(stateDir: string) {
  const passwordFile = join(stateDir, "own-password.json");
  return {
    read: (): string | null => readPrivateJson(passwordFile, z.string().min(1).nullable(), null),
    write(password: string | null) {
      if (password !== null) writePrivateJson(passwordFile, password);
      else if (existsSync(passwordFile)) rmSync(passwordFile);
    },
  };
}
