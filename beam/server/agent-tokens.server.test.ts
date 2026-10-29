import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_TOKEN_ENV, claimAgentToken, createAgentTokens } from "./agent-tokens.server";
import { makeTempDir } from "./temp-dir.test-support";

const openingWith = (env: Record<string, string>) => ({
  agentId: "agent-codex",
  workspaceId: "ws-1",
  provider: "codex",
  cwd: "/repo",
  reason: "create" as const,
  purpose: "interactive" as const,
  env,
});

describe("agent tokens", () => {
  it("finds the agent a token was bound to after the daemon restarts, because a resumed agent keeps its token", () => {
    const path = join(makeTempDir("beam-tokens-"), "agent-tokens.json");
    createAgentTokens(path).bind("token-1", "agent-codex");

    expect(createAgentTokens(path).agentIdFor("token-1")).toBe("agent-codex");
    expect(createAgentTokens(path).agentIdFor("token-2")).toBeNull();
  });

  it("keeps the file readable by its owner only, since a token stands in for an agent", () => {
    const path = join(makeTempDir("beam-tokens-"), "agent-tokens.json");
    createAgentTokens(path).bind("token-1", "agent-codex");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("refuses a file it cannot read rather than treating every token as unknown", () => {
    const path = join(makeTempDir("beam-tokens-"), "agent-tokens.json");
    writeFileSync(path, "not json");
    expect(() => createAgentTokens(path).agentIdFor("token-1")).toThrow(path);
  });
});

describe("claimAgentToken", () => {
  it("binds the token to the opening agent and keeps it out of the agent's environment", () => {
    const tokens = createAgentTokens(join(makeTempDir("beam-tokens-"), "agent-tokens.json"));
    const env = claimAgentToken(openingWith({ PATH: "/bin", [AGENT_TOKEN_ENV]: "token-1" }), tokens);

    expect(env).toEqual({ PATH: "/bin" });
    expect(tokens.agentIdFor("token-1")).toBe("agent-codex");
  });

  it("leaves an agent without a token alone, such as one resumed after a restart", () => {
    const path = join(makeTempDir("beam-tokens-"), "agent-tokens.json");
    const env = { PATH: "/bin" };
    expect(claimAgentToken(openingWith(env), createAgentTokens(path))).toBe(env);
  });
});
