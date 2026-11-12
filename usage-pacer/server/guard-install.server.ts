import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guardFiles } from "./guard-files.generated";

// The plugin's install folder changes on every update and its bundled code cannot find it, so the guard runs from the state folder.
export async function installGuard(stateDir: string): Promise<void> {
  const guardDir = join(stateDir, "guard");
  await mkdir(guardDir, { recursive: true });
  await Promise.all(
    Object.entries(guardFiles).map(async ([name, text]) => {
      const file = join(guardDir, name);
      const temp = `${file}.tmp`;
      await writeFile(temp, text, { mode: name === "guard.py" ? 0o755 : 0o644 });
      await rename(temp, file);
    }),
  );
}
