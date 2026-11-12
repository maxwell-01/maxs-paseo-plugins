import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { guardFiles } from "./guard-files.generated";

// The plugin's install folder changes on every update and its bundled code cannot find it, so the guard runs from the state folder.
export async function installGuard(stateDir: string): Promise<void> {
  const guardDir = join(stateDir, "guard");
  await mkdir(guardDir, { recursive: true });
  const stale = (await readdir(guardDir)).filter((name) => name !== "__pycache__" && !(name in guardFiles));
  await Promise.all(stale.map((name) => rm(join(guardDir, name), { recursive: true, force: true })));
  await Promise.all(
    Object.entries(guardFiles).map(async ([name, text]) => {
      const file = join(guardDir, name);
      if ((await readFile(file, "utf8").catch(() => undefined)) === text) return;
      const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(temp, text, { mode: name === "guard.py" ? 0o755 : 0o644 });
      await rename(temp, file);
    }),
  );
}
