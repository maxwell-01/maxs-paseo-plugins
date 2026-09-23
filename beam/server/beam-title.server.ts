const BEAMING_TITLE_PREFIX = "⚡ ";

interface WorkspaceTitleHandle {
  current(): { title?: string | null; name: string } | null;
  refresh(): Promise<unknown>;
  setTitle(title: string | null): Promise<unknown>;
}

export interface WorkspaceTitlePort {
  workspaces: { ref(workspaceId: string): WorkspaceTitleHandle };
}

export function beamingTitle(title: string | null, workspaceName: string): string {
  return `${BEAMING_TITLE_PREFIX}${title ?? workspaceName}`;
}

function unmarked(title: string | null, workspaceName: string): string | null {
  if (title === null || !title.startsWith(BEAMING_TITLE_PREFIX)) {
    return title;
  }
  const bare = title.slice(BEAMING_TITLE_PREFIX.length);
  return bare === workspaceName ? null : bare;
}

export async function readWorkspaceTitle(
  port: WorkspaceTitlePort,
  workspaceId: string,
): Promise<{ title: string | null; name: string } | null> {
  const handle = port.workspaces.ref(workspaceId);
  await handle.refresh();
  const workspace = handle.current();
  if (!workspace) {
    return null;
  }
  return { title: unmarked(workspace.title ?? null, workspace.name), name: workspace.name };
}

export async function applyBeamingTitle(
  port: WorkspaceTitlePort,
  workspaceId: string,
  originalTitle: string | null,
  workspaceName: string,
): Promise<void> {
  await port.workspaces.ref(workspaceId).setTitle(beamingTitle(originalTitle, workspaceName));
}

export async function restoreWorkspaceTitle(
  port: WorkspaceTitlePort,
  workspaceId: string | undefined,
  originalTitle: string | null | undefined,
): Promise<void> {
  if (!workspaceId || originalTitle === undefined) {
    return;
  }
  const handle = port.workspaces.ref(workspaceId);
  await handle.refresh();
  const workspace = handle.current();
  if (!workspace || (workspace.title ?? null) !== beamingTitle(originalTitle, workspace.name)) {
    return;
  }
  await handle.setTitle(originalTitle);
}
