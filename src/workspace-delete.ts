import type { WorkspaceInfo } from "./store";

export type WorkspaceDeletion = {
  allowed: boolean;
  opens: WorkspaceInfo | null;
};

export function workspaceDeletion(
  workspaces: WorkspaceInfo[],
  activeId: string,
  hasAccount: boolean,
): WorkspaceDeletion {
  const active = workspaces.find((workspace) => workspace.id === activeId);
  const remaining = workspaces.filter((workspace) => workspace.id !== activeId);
  return {
    allowed:
      active?.role !== "collaborator" &&
      (hasAccount ||
        remaining.some((workspace) => workspace.role !== "collaborator")),
    opens: remaining[0] ?? null,
  };
}
