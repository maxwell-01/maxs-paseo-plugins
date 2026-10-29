import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { z } from "zod";

// Codex starts MCP servers with only a few of its own environment variables, so a beam server
// launched by Codex never sees PASEO_AGENT_ID. Beam names each agent's server with a random token
// instead, and learns which agent holds it when Paseo opens that agent's session.
export const AGENT_TOKEN_ENV = "BEAM_AGENT_TOKEN";

const OWNER_ONLY_DIR = 0o700;
const OWNER_ONLY_FILE = 0o600;

const tokensFileSchema = z.record(z.string(), z.string());

export function createAgentTokens(path: string) {
  let agentIdsByToken: Record<string, string> | null = null;
  const load = () => {
    agentIdsByToken ??= existsSync(path) ? tokensFileSchema.parse(JSON.parse(readFileSync(path, "utf8"))) : {};
    return agentIdsByToken;
  };
  return {
    bind(token: string, agentId: string): void {
      const next = { ...load(), [token]: agentId };
      mkdirSync(dirname(path), { recursive: true, mode: OWNER_ONLY_DIR });
      const staging = `${path}.${process.pid}.tmp`;
      writeFileSync(staging, JSON.stringify(next), { mode: OWNER_ONLY_FILE });
      renameSync(staging, path);
      agentIdsByToken = next;
    },
    agentIdFor(token: string): string | null {
      return load()[token] ?? null;
    },
  };
}

export type AgentTokens = ReturnType<typeof createAgentTokens>;

type SessionOpening = PluginBeforeRequests["agent.session_open"];

export function claimAgentToken(opening: SessionOpening, tokens: AgentTokens): SessionOpening["env"] {
  const { [AGENT_TOKEN_ENV]: token, ...env } = opening.env;
  if (token === undefined) return opening.env;
  tokens.bind(token, opening.agentId);
  return env;
}
