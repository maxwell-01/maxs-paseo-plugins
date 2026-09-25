import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoKeySchema } from "../shared/repo-notes.shared";

const runFile = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const GIT_EXIT_NO_SUCH_REMOTE = 2;
// A one-letter host is a Windows drive, as in "C:/src/app".
const SCP_LIKE_REMOTE = /^(?:[^/@]+@)?([^:/\\]{2,}):(.+)$/;

function splitRemote(url: string): { host: string; path: string } | null {
  const scpLike = url.includes("://") ? null : SCP_LIKE_REMOTE.exec(url);
  if (scpLike) return { host: scpLike[1], path: scpLike[2] };
  if (!URL.canParse(url)) return null;
  const { hostname, pathname } = new URL(url);
  return { host: hostname, path: pathname };
}

export function parseRepoKey(remoteUrl: string): string | null {
  const remote = splitRemote(remoteUrl);
  if (!remote) return null;
  const segments = remote.path.toLowerCase().replace(/\.git\/?$/, "").split("/").filter((segment) => segment !== "");
  const key = [remote.host.toLowerCase(), ...segments].join("/");
  return repoKeySchema.safeParse(key).success ? key : null;
}

function isNoRepoOrNoOrigin(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const exitCode: unknown = Reflect.get(error, "code");
  const stderr: unknown = Reflect.get(error, "stderr");
  return exitCode === GIT_EXIT_NO_SUCH_REMOTE || (typeof stderr === "string" && stderr.includes("not a git repository"));
}

// A git blocked on a hung mount ignores the kill that execFile's own timeout sends, and Paseo fails
// agent creation when a hook takes 30 s.
function rejectAfter(ms: number): { promise: Promise<never>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`git gave no answer in ${ms} ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function readRepoKey(cwd: string): Promise<string | null> {
  const deadline = rejectAfter(GIT_TIMEOUT_MS);
  try {
    const { stdout } = await Promise.race([
      runFile("git", ["-C", cwd, "remote", "get-url", "origin"], { timeout: GIT_TIMEOUT_MS, env: { ...process.env, LC_ALL: "C" } }),
      deadline.promise,
    ]);
    return parseRepoKey(stdout.trim());
  } catch (error) {
    if (isNoRepoOrNoOrigin(error)) return null;
    throw error;
  } finally {
    deadline.cancel();
  }
}
