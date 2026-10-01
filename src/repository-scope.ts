import { projectPaths, type Workspace } from "./domain.ts";

/**
 * The backend refuses the same change with this sentence (RepositoryScope.cs).
 * Only the workspace owner picks which GitHub repositories, layout and project
 * folders a workspace uses; that choice is what collaborators may read.
 */
export const ownerOnlyRepositoryMessage =
  "Only the workspace owner can change which GitHub repositories and folders this workspace uses.";

function repositoryKey(url: string | undefined): string {
  const text = (url ?? "").trim();
  const match = text.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]{1,100})\/([A-Za-z0-9._-]{1,150})(?:[/#?].*)?$/i,
  );
  if (!match) return text.toLowerCase();
  return `${match[1]}/${match[2].replace(/\.git$/i, "")}`.toLowerCase();
}

function layout(state: Workspace): string {
  return (
    state.map.repositoryLayout ??
    (state.map.repositoryUrl ? "monorepo" : "multirepo")
  );
}

function sameFolders(a: string[], b: string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * True when `next` changes what the workspace reads on GitHub compared with
 * `previous`: the workspace repository or layout, a kept project's repository
 * or folders, or a new project with folders or with a repository the
 * workspace did not already name. Removing a project is not a change here.
 */
export function repositoryScopeChanged(
  previous: Workspace,
  next: Workspace,
): boolean {
  if (
    repositoryKey(previous.map.repositoryUrl) !==
      repositoryKey(next.map.repositoryUrl) ||
    layout(previous) !== layout(next)
  )
    return true;
  const known = new Map(previous.projects.map((p) => [p.id, p]));
  const allowed = new Set(
    [
      previous.map.repositoryUrl,
      ...previous.projects.map((p) => p.repositoryUrl),
    ]
      .filter((url) => url?.trim())
      .map(repositoryKey),
  );
  return next.projects.some((project) => {
    const old = known.get(project.id);
    if (old)
      return (
        repositoryKey(old.repositoryUrl) !==
          repositoryKey(project.repositoryUrl) ||
        !sameFolders(projectPaths(old), projectPaths(project))
      );
    return (
      projectPaths(project).length > 0 ||
      (!!project.repositoryUrl?.trim() &&
        !allowed.has(repositoryKey(project.repositoryUrl)))
    );
  });
}
