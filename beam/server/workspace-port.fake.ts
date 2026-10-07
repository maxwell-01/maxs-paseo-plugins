import type { WorkspaceTitlePort } from "./beam-title.server";
import type { StaleHolderPort } from "./stale-holder.server";

export function createFakeWorkspacePort(
  workspace: { slug: string; title: string | null; archivingAt?: string | null } | null,
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
          return state && { ...state, archivingAt: state.archivingAt ?? null };
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
  } satisfies WorkspaceTitlePort & StaleHolderPort;
  return {
    port,
    setTitleCalls,
    currentTitle: () => state?.title ?? null,
    startArchiving: (at: string) => {
      state = state && { ...state, archivingAt: at };
    },
    failures,
  };
}
