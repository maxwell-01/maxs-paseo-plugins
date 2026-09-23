const BEAMING_TITLE_PREFIX = "⚡ ";

interface WorkspaceTitleHandle {
  current(): { title?: string | null; name: string } | null;
  refresh(): Promise<unknown>;
  setTitle(title: string | null): Promise<unknown>;
}

export interface WorkspaceTitlePort {
  workspaces: { ref(workspaceId: string): WorkspaceTitleHandle };
}

export interface TitleMark {
  originalTitle: string | null;
  markedTitle: string;
}

export function beamingTitle(title: string | null, workspaceName: string): string {
  return `${BEAMING_TITLE_PREFIX}${title ?? workspaceName}`;
}

function unmarked(title: string | null): string | null {
  return title?.startsWith(BEAMING_TITLE_PREFIX) ? title.slice(BEAMING_TITLE_PREFIX.length) : title;
}

export async function readWorkspaceTitle(
  port: WorkspaceTitlePort,
  workspaceId: string,
): Promise<TitleMark | null> {
  const handle = port.workspaces.ref(workspaceId);
  await handle.refresh();
  const workspace = handle.current();
  if (!workspace) {
    return null;
  }
  const originalTitle = unmarked(workspace.title ?? null);
  return { originalTitle, markedTitle: beamingTitle(originalTitle, workspace.name) };
}

export async function applyBeamingTitle(
  port: WorkspaceTitlePort,
  workspaceId: string,
  mark: TitleMark,
): Promise<void> {
  await port.workspaces.ref(workspaceId).setTitle(mark.markedTitle);
}

export async function restoreWorkspaceTitle(
  port: WorkspaceTitlePort,
  workspaceId: string,
  mark: TitleMark | undefined,
): Promise<void> {
  if (!mark) {
    return;
  }
  const handle = port.workspaces.ref(workspaceId);
  await handle.refresh();
  if ((handle.current()?.title ?? null) !== mark.markedTitle) {
    return;
  }
  await handle.setTitle(mark.originalTitle);
}
