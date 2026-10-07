import type { AgentBeamPort } from "./agent-beam.server";

interface FakeWorkspace {
  name: string;
  directory: string;
  title: string | null;
}

interface FakeAgent {
  workspaceId: string | null;
  provider: string;
}

export function createFakeAgentPort(input: {
  workspaces: Record<string, FakeWorkspace>;
  agents: Record<string, FakeAgent>;
}) {
  const workspaces = new Map(Object.entries(input.workspaces));
  const agents = new Map(Object.entries(input.agents));
  const port = {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const agent = agents.get(agentId);
          return agent ? { agent } : null;
        },
      }),
    },
    workspaces: {
      ref: (workspaceId: string) => ({
        current: () => {
          const workspace = workspaces.get(workspaceId);
          return workspace ? { name: workspace.name, title: workspace.title } : null;
        },
        refresh: async () => {
          const workspace = workspaces.get(workspaceId);
          return workspace
            ? { name: workspace.name, workspaceDirectory: workspace.directory, archivingAt: null }
            : null;
        },
        setTitle: async (title: string | null) => {
          const workspace = workspaces.get(workspaceId);
          if (workspace) {
            workspaces.set(workspaceId, { ...workspace, title });
          }
          return { title };
        },
      }),
    },
  } satisfies AgentBeamPort;
  return {
    port,
    titleOf: (workspaceId: string) => workspaces.get(workspaceId)?.title ?? null,
    unlist: (workspaceId: string) => workspaces.delete(workspaceId),
  };
}
