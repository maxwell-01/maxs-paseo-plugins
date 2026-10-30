import { existsSync, readFileSync } from "node:fs";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { z } from "zod";
import { writeFileAtomically } from "./atomic-file.server";

// Codex starts MCP servers with only a few of its own environment variables, so a beam server
// launched by Codex never sees PASEO_AGENT_ID. Beam names that server with a random token instead,
// and learns which agent holds it when Paseo opens that agent's session.
export const AGENT_TOKEN_ENV = "BEAM_AGENT_TOKEN";

const OWNER_ONLY_FILE = 0o600;

const tokensFileSchema = z.record(z.string(), z.string());

export function createAgentTokens(path: string) {
  const read = () => {
    if (!existsSync(path)) return {};
    try {
      return tokensFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new Error(`beam cannot read its agent tokens in ${path}`, { cause: error });
    }
  };
  return {
    bind(token: string, agentId: string): void {
      writeFileAtomically(path, JSON.stringify({ ...read(), [token]: agentId }), OWNER_ONLY_FILE);
    },
    agentIdFor(token: string): string | null {
      return read()[token] ?? null;
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
