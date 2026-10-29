import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// The tests run inside a Paseo agent, whose own identity must not leak into the proxy.
function envWith(callerEnv: Record<string, string>) {
  const { PASEO_AGENT_ID: _agentId, BEAM_AGENT_TOKEN: _token, ...env } = process.env;
  return { ...env, ...callerEnv };
}

export function startProxy(proxyPath: string, callerEnv: Record<string, string>) {
  const child = spawn(process.execPath, [proxyPath], { env: envWith(callerEnv) });
  const replies = createInterface({ input: child.stdout });
  const pending = new Map<number, (reply: any) => void>();
  replies.on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
  });
  let nextId = 1;
  const notify = (method: string, params: unknown = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  const start = (method: string, params: unknown = {}) => {
    const id = nextId++;
    const reply = new Promise<{ result?: any; error?: { code: number; message: string } }>((resolve) => {
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    return { id, reply };
  };
  const request = (method: string, params: unknown = {}) => start(method, params).reply;
  const sendRaw = (line: string) =>
    new Promise<any>((resolve) => {
      replies.once("line", (reply) => resolve(JSON.parse(reply)));
      child.stdin.write(`${line}\n`);
    });
  return { child, request, start, notify, sendRaw };
}

export function runCli(proxyPath: string, args: string[], agentId = "agent-cli") {
  const child = spawn(process.execPath, [proxyPath, ...args], { env: envWith({ PASEO_AGENT_ID: agentId }) });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
}
