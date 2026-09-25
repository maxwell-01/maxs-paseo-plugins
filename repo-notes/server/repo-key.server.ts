import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoKeySchema } from "../shared/repo-notes.shared";

const runFile = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const GIT_EXIT_NO_SUCH_REMOTE = 2;
const SCP_LIKE_REMOTE = /^[^/@]+@([^:/]+):(.+)$/;

function splitRemote(url: string): { host: string; path: string } | null {
  const scpLike = SCP_LIKE_REMOTE.exec(url);
  if (scpLike) return { host: scpLike[1], path: scpLike[2] };
  if (!URL.canParse(url)) return null;
  const { hostname, pathname } = new URL(url);
  return { host: hostname, path: pathname };
}

export function parseRepoKey(remoteUrl: string): string | null {
  const remote = splitRemote(remoteUrl);
  if (!remote) return null;
  const segments = remote.path.replace(/\.git\/?$/, "").split("/").filter((segment) => segment !== "");
  const key = [remote.host, ...segments].join("/").toLowerCase();
  return repoKeySchema.safeParse(key).success ? key : null;
}

function isNoRepoOrNoOrigin(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const exitCode: unknown = Reflect.get(error, "code");
  const stderr: unknown = Reflect.get(error, "stderr");
  return exitCode === GIT_EXIT_NO_SUCH_REMOTE || (typeof stderr === "string" && stderr.includes("not a git repository"));
}

export async function readRepoKey(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: GIT_TIMEOUT_MS });
    return parseRepoKey(stdout.trim());
  } catch (error) {
    if (isNoRepoOrNoOrigin(error)) return null;
    throw error;
  }
}
