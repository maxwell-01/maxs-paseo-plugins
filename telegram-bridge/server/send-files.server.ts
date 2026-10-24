import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, sep } from "node:path";
import { describeError } from "./describe-error.server";
import { takeMarkedLines } from "./marked-lines.server";

const SEND_LINE = /^\s*\[\[send:\s*(.+?)\s*\]\]\s*$/;
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const BOT_PHOTO_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const BOT_FILE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

export interface FileToSend {
  path: string;
  kind: "photo" | "document";
}

// Folders whose files never go to a chat, however the reply names them: an agent that read an injected instruction
// could otherwise post a key or the bot token to everyone in the group.
export interface SendPolicy {
  home: string;
  paseoHome: string;
  bridgeFilesDir: string;
}

const isInside = (path: string, dir: string) => {
  const fromDir = relative(dir, path);
  return fromDir === "" || (!fromDir.startsWith("..") && !isAbsolute(fromDir));
};

function refusal(path: string, { home, paseoHome, bridgeFilesDir }: SendPolicy): string | null {
  if (basename(path).startsWith(".")) return "it is a hidden file";
  if (isInside(path, bridgeFilesDir)) return null;
  if (isInside(path, paseoHome)) return "it is inside Paseo's own folder";
  if (isInside(path, home) && relative(home, path).split(sep).some((segment) => segment.startsWith("."))) return "it is inside a hidden folder";
  return null;
}

async function checkFile(path: string, policy: SendPolicy): Promise<FileToSend | { problem: string }> {
  if (!isAbsolute(path)) return { problem: `Could not send ${path}: it is not an absolute path.` };
  let real: string;
  let info;
  try {
    real = await realpath(path);
    info = await stat(real);
  } catch (error) {
    return { problem: `Could not send ${path}: ${describeError(error)}` };
  }
  const refused = refusal(real, policy);
  if (refused) return { problem: `Could not send ${path}: ${refused}.` };
  if (!info.isFile()) return { problem: `Could not send ${path}: it is not a file.` };
  if (info.size > BOT_FILE_UPLOAD_LIMIT_BYTES) return { problem: `Could not send ${path}: it is over Telegram's 50 MB bot upload limit.` };
  const isPhoto = PHOTO_EXTENSIONS.has(extname(path).toLowerCase()) && info.size <= BOT_PHOTO_UPLOAD_LIMIT_BYTES;
  return { path: real, kind: isPhoto ? "photo" : "document" };
}

async function realOrAsGiven(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return path;
    throw error;
  }
}

export async function planReply(reply: string, givenPolicy: SendPolicy): Promise<{ body: string; files: FileToSend[] }> {
  const { text, values: paths } = takeMarkedLines(reply, SEND_LINE);
  const policy: SendPolicy = {
    home: await realOrAsGiven(givenPolicy.home),
    paseoHome: await realOrAsGiven(givenPolicy.paseoHome),
    bridgeFilesDir: await realOrAsGiven(givenPolicy.bridgeFilesDir),
  };
  const files: FileToSend[] = [];
  const problems: string[] = [];
  for (const checked of await Promise.all(paths.map((path) => checkFile(path, policy)))) {
    if ("problem" in checked) problems.push(checked.problem);
    else files.push(checked);
  }
  return { body: [text, ...problems].filter(Boolean).join("\n\n"), files };
}
