import type { WorkspaceTitlePort } from "./beam-title.server";

export function createFakeWorkspacePort(
  workspace: { slug: string; title: string | null } | null,
  failures: { refresh?: boolean; setTitle?: boolean } = {},
) {
  const setTitleCalls: Array<string | null> = [];
  let state = workspace;
  const port = {
    workspaces: {
      ref: () => ({
        current: () => (state ? { name: state.title ?? state.slug, title: state.title } : null),
        refresh: async () => {
          if (failures.refresh) {
            throw new Error("daemon unreachable");
          }
          return state;
        },
        setTitle: async (title: string | null) => {
          if (failures.setTitle) {
            throw new Error("daemon unreachable");
          }
          setTitleCalls.push(title);
          state = state ? { ...state, title } : state;
          return { title };
        },
      }),
    },
  } satisfies WorkspaceTitlePort;
  return { port, setTitleCalls, currentTitle: () => state?.title ?? null, failures };
}
