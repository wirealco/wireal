import {
  normalizeCommitUrl,
  normalizeProjectPath,
  projectPaths,
  projectRepository,
  repositoryLayout,
  type Project,
  type Task,
  type Workspace,
  taskIdLabel,
} from "./domain";
import type { ProxyCommitError, ProxyCommitResult } from "./github-connection";

export type CommitFileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export type CommitFile = {
  path: string;
  previousPath?: string;
  status: CommitFileStatus;
  additions: number;
  deletions: number;
};

export type CommitRef = {
  url: string;
  owner: string;
  repo: string;
  sha: string;
};

export function commitRef(url: string): CommitRef {
  const normalized = normalizeCommitUrl(url);
  const parts = new URL(normalized).pathname.split("/").filter(Boolean);
  return {
    url: normalized,
    owner: parts[0],
    repo: parts[1],
    sha: parts[3],
  };
}

export type CommitFilesError = ProxyCommitError;

export const commitErrorKeys: Record<CommitFilesError["kind"], string> = {
  unauthorized: "taskFiles.errorUnauthorized",
  "not-found": "taskFiles.errorNotFound",
  "rate-limited": "taskFiles.errorRateLimited",
  network: "taskFiles.errorNetwork",
  invalid: "taskFiles.errorInvalid",
  "not-connected": "taskFiles.errorNotConnected",
};

export const commitUrlProxyChunkSize = 100;

export type CommitFilesResult =
  | {
      ref: CommitRef;
      files: CommitFile[];
      committedAt?: string | null;
      error?: undefined;
    }
  | {
      ref: CommitRef;
      files?: undefined;
      committedAt?: undefined;
      error: CommitFilesError;
    };

type FetchCommitFilesOptions = {
  fetch?: typeof fetch;
  proxy?: (urls: string[]) => Promise<ProxyCommitResult[]>;
};

const commitFilesCache = new Map<string, Promise<CommitFilesResult>>();
const statuses = new Set<CommitFileStatus>([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
  "unchanged",
]);
const notConnectedFallbackKinds = new Set<CommitFilesError["kind"]>([
  "not-found",
  "unauthorized",
  "rate-limited",
]);

const invalidRef = (url: string): CommitRef => ({
  url,
  owner: "",
  repo: "",
  sha: "",
});

const errorForResponse = (response: Response): CommitFilesError => {
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  )
    return { kind: "rate-limited", status: response.status };
  if (response.status === 401 || response.status === 403)
    return { kind: "unauthorized", status: response.status };
  if (response.status === 404)
    return { kind: "not-found", status: response.status };
  return { kind: "network", status: response.status };
};

const commitFile = (value: unknown): CommitFile | null => {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.filename !== "string") return null;
  const status = statuses.has(item.status as CommitFileStatus)
    ? (item.status as CommitFileStatus)
    : "changed";
  return {
    path: item.filename,
    ...(typeof item.previous_filename === "string"
      ? { previousPath: item.previous_filename }
      : {}),
    status,
    additions: typeof item.additions === "number" ? item.additions : 0,
    deletions: typeof item.deletions === "number" ? item.deletions : 0,
  };
};

export function fetchCommitFiles(
  url: string,
  options: FetchCommitFilesOptions = {},
): Promise<CommitFilesResult> {
  let ref: CommitRef;
  try {
    ref = commitRef(url);
  } catch {
    return Promise.resolve({
      ref: invalidRef(url),
      error: { kind: "invalid" },
    });
  }

  const cached = commitFilesCache.get(ref.url);
  if (cached) return cached;

  const request = (async (): Promise<CommitFilesResult> => {
    const files: CommitFile[] = [];
    let committedAt: string | undefined;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    try {
      for (let page = 1; page <= 10; page += 1) {
        const response = await (options.fetch ?? globalThis.fetch)(
          `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits/${ref.sha}?per_page=300&page=${page}`,
          { headers },
        );
        if (!response.ok) return { ref, error: errorForResponse(response) };
        const body = (await response.json()) as {
          files?: unknown;
          commit?: {
            author?: { date?: unknown };
            committer?: { date?: unknown };
          };
        };
        if (!Array.isArray(body.files))
          return { ref, error: { kind: "network" } };
        if (!committedAt) {
          const when =
            body.commit?.committer?.date ?? body.commit?.author?.date;
          if (typeof when === "string") committedAt = when;
        }
        const pageFiles = body.files
          .map(commitFile)
          .filter((file): file is CommitFile => file !== null);
        files.push(...pageFiles);
        if (body.files.length < 300) break;
      }
      return { ref, files, ...(committedAt ? { committedAt } : {}) };
    } catch {
      return { ref, error: { kind: "network" } };
    }
  })();

  commitFilesCache.set(ref.url, request);
  void request.then((result) => {
    if (result.error && commitFilesCache.get(ref.url) === request)
      commitFilesCache.delete(ref.url);
  });
  return request;
}

export function clearCommitFilesCache() {
  commitFilesCache.clear();
}

export function taskCommitFiles(
  task: Task,
  options: FetchCommitFilesOptions = {},
): Promise<CommitFilesResult[]> {
  return commitUrlFiles(task.commitUrls, options);
}

export async function commitUrlFiles(
  urls: readonly string[],
  options: FetchCommitFilesOptions = {},
): Promise<CommitFilesResult[]> {
  const direct = async (url: string): Promise<CommitFilesResult> => {
    try {
      return await fetchCommitFiles(url, { fetch: options.fetch });
    } catch {
      let ref: CommitRef;
      try {
        ref = commitRef(url);
      } catch {
        ref = invalidRef(url);
      }
      return { ref, error: { kind: "network" } };
    }
  };
  if (!options.proxy) return Promise.all(urls.map(direct));

  const results = new Array<CommitFilesResult>(urls.length);
  const pending: { index: number; url: string; cacheKey?: string }[] = [];
  const cached: Promise<void>[] = [];
  for (const [index, url] of urls.entries()) {
    let cacheKey: string | undefined;
    try {
      cacheKey = commitRef(url).url;
    } catch {
      pending.push({ index, url });
      continue;
    }
    const hit = commitFilesCache.get(cacheKey);
    if (hit) {
      cached.push(
        hit.then((result) => {
          results[index] = result;
        }),
      );
    } else pending.push({ index, url, cacheKey });
  }
  await Promise.all(cached);
  if (!pending.length) return results;

  const proxied: (ProxyCommitResult | undefined)[] = [];
  for (
    let start = 0;
    start < pending.length;
    start += commitUrlProxyChunkSize
  ) {
    const chunk = pending.slice(start, start + commitUrlProxyChunkSize);
    try {
      const chunkResults = await options.proxy(chunk.map((item) => item.url));
      proxied.push(...chunk.map((_, index) => chunkResults[index]));
    } catch {
      proxied.push(
        ...chunk.map(({ url }) => ({
          url,
          error: { kind: "not-connected" as const },
        })),
      );
    }
  }

  await Promise.all(
    pending.map(async ({ index, url, cacheKey }, pendingIndex) => {
      const item = proxied[pendingIndex];
      if (!item) {
        results[index] = { ref: invalidRef(url), error: { kind: "network" } };
        return;
      }
      if ("error" in item) {
        if (item.error.kind === "not-connected") {
          const fallback = await direct(url);
          results[index] =
            fallback.error && notConnectedFallbackKinds.has(fallback.error.kind)
              ? {
                  ref: fallback.ref,
                  error: { ...fallback.error, kind: "not-connected" },
                }
              : fallback;
          return;
        }
        let ref: CommitRef;
        try {
          ref = commitRef(item.url);
        } catch {
          ref = invalidRef(item.url);
        }
        results[index] = { ref, error: item.error };
        return;
      }
      const result: CommitFilesResult = {
        ref: {
          url: item.url,
          owner: item.owner,
          repo: item.repo,
          sha: item.sha,
        },
        files: item.files.map((file) => ({
          path: file.path,
          ...(file.previousPath ? { previousPath: file.previousPath } : {}),
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
        })),
        committedAt: item.committedAt,
      };
      results[index] = result;
      if (cacheKey) commitFilesCache.set(cacheKey, Promise.resolve(result));
    }),
  );
  return results;
}

export type TaskFile = {
  path: string;
  folder: string;
  name: string;
  status: CommitFileStatus;
  additions: number;
  deletions: number;
  commits: number;
  shas: string[];
  projectId: string | null;
  tint: string;
};

export type TaskFolder = {
  id: string;
  label: string;
  labelKey?: string;
  paths: string[];
  tint: string;
};

export type TaskCommit = {
  ref: CommitRef;
  paths: string[];
  additions: number;
  deletions: number;
  committedAt?: string | null;
  error?: CommitFilesError;
  title?: string;
  taskId?: string;
};

export const groupModes = ["projects", "paths", "types"] as const;
export type GroupBy = (typeof groupModes)[number];
export const defaultGroupBy: GroupBy = "paths";

export function storedGroupBy(storage: Pick<Storage, "getItem">): GroupBy {
  try {
    const saved = storage.getItem("wireal.commits.groupBy");
    return groupModes.includes(saved as GroupBy)
      ? (saved as GroupBy)
      : defaultGroupBy;
  } catch {
    return defaultGroupBy;
  }
}

export type FilesModelOptions = {
  groupBy?: GroupBy;
  projectId?: string | null;
};

export type TaskFilesModel = {
  label: string;
  groupBy: GroupBy;
  commits: CommitFilesResult[];
  loaded: CommitFilesResult[];
  failed: CommitFilesResult[];
  timeline: TaskCommit[];
  latest: TaskCommit | null;
  files: TaskFile[];
  filesByPath: Map<string, TaskFile>;
  folders: TaskFolder[];
  projects: Map<string, Project>;
  projectColors: Map<string, string>;
  additions: number;
  deletions: number;
};

export function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function folderLabel(folder: string): string {
  return folder ? `${folder}/` : "/";
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function projectKeys(
  projects: readonly { id: string; name: string; repositoryUrl: string }[],
): Map<string, string> {
  const keys = new Map<string, string>();
  for (const project of projects) {
    const repository = project.repositoryUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop();
    for (const key of [slug(project.name), slug(repository ?? "")])
      if (key && !keys.has(key)) keys.set(key, project.id);
  }
  return keys;
}

export function pathProject(
  path: string,
  keys: ReadonlyMap<string, string>,
): string | null {
  const folders = path.split("/").slice(0, -1);
  for (let index = folders.length - 1; index >= 0; index -= 1) {
    const id = keys.get(slug(folders[index]));
    if (id) return id;
  }
  return null;
}

export function fileProject(
  path: string,
  repository: string,
  state: Workspace,
): string | null {
  const multirepo = repositoryLayout(state) === "multirepo";
  const candidates = multirepo
    ? state.projects.filter(
        (project) =>
          projectRepository(state, project).toLowerCase() ===
          repository.toLowerCase(),
      )
    : state.projects;
  const normalizedPath = normalizeProjectPath(path);
  let match: { id: string; length: number } | undefined;
  for (const project of candidates)
    for (const folder of projectPaths(project))
      if (
        (normalizedPath === folder ||
          normalizedPath.startsWith(`${folder}/`)) &&
        (!match || folder.length > match.length)
      )
        match = { id: project.id, length: folder.length };
  if (match) return match.id;
  if (multirepo) {
    const defaults = candidates.filter(
      (project) => projectPaths(project).length === 0,
    );
    if (defaults.length === 1) return defaults[0].id;
  }
  return pathProject(path, projectKeys(candidates));
}

export function topFolder(path: string): string {
  const cut = path.indexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export const rootTint = "#8d93a5";
export const folderPalette = [
  "#5b8cff",
  "#45d797",
  "#ffb33e",
  "#ef6387",
  "#9b7bff",
  "#31c7d4",
  "#f97362",
  "#8bc34a",
  "#e879c7",
  "#4db6e2",
];

const hashOf = (value: string) => {
  let total = 0;
  for (let index = 0; index < value.length; index += 1)
    total = (total * 31 + value.charCodeAt(index)) >>> 0;
  return total;
};

export function folderTints(
  files: readonly { path: string; projectId: string | null }[],
  projectColors: ReadonlyMap<string, string>,
): Map<string, string> {
  const taken = new Set<string>();
  for (const file of files)
    if (file.projectId) {
      const color = projectColors.get(file.projectId);
      if (color) taken.add(color.toLowerCase());
    }
  const tints = new Map<string, string>();
  const tops = [
    ...new Set(
      files
        .filter((file) => !file.projectId)
        .map((file) => topFolder(file.path)),
    ),
  ].sort();
  for (const top of tops) {
    if (!top) {
      tints.set(top, rootTint);
      continue;
    }
    const start = hashOf(top) % folderPalette.length;
    let chosen = folderPalette[start];
    for (let step = 0; step < folderPalette.length; step += 1) {
      const candidate = folderPalette[(start + step) % folderPalette.length];
      if (!taken.has(candidate.toLowerCase())) {
        chosen = candidate;
        break;
      }
    }
    taken.add(chosen.toLowerCase());
    tints.set(top, chosen);
  }
  return tints;
}

export function fileExtension(path: string): string {
  const name = fileName(path);
  const cut = name.lastIndexOf(".");
  return cut <= 0 ? "" : name.slice(cut);
}

export function paletteTint(key: string): string {
  return folderPalette[hashOf(key) % folderPalette.length];
}

export function cellLabel(
  model: Pick<TaskFilesModel, "groupBy" | "projects">,
  file: Pick<TaskFile, "path" | "name" | "projectId">,
): string {
  if (model.groupBy === "paths") return file.name;
  if (model.groupBy !== "projects") return file.path;
  const project = file.projectId ? model.projects.get(file.projectId) : null;
  const normalized = normalizeProjectPath(file.path);
  let longest = "";
  for (const folder of project ? projectPaths(project) : [])
    if (
      (normalized === folder || normalized.startsWith(`${folder}/`)) &&
      folder.length > longest.length
    )
      longest = folder;
  if (!longest) return file.path;
  return normalized.slice(longest.length + 1) || file.name;
}

const bucket = (groups: Map<string, string[]>, key: string, path: string) => {
  const paths = groups.get(key);
  if (paths) paths.push(path);
  else groups.set(key, [path]);
};

const trailing = (folders: TaskFolder[]) => [
  ...folders.filter((folder) => folder.id),
  ...folders.filter((folder) => !folder.id),
];

function groupedFolders(
  groupBy: GroupBy,
  files: readonly TaskFile[],
  state: Workspace,
  filesByPath: ReadonlyMap<string, TaskFile>,
): TaskFolder[] {
  const groups = new Map<string, string[]>();
  if (groupBy === "projects") {
    for (const file of files) bucket(groups, file.projectId ?? "", file.path);
    const folders: TaskFolder[] = [];
    for (const project of state.projects) {
      const paths = groups.get(project.id);
      if (!paths) continue;
      folders.push({
        id: project.id,
        label: project.name,
        paths: [...paths].sort(),
        tint: project.color,
      });
    }
    const rest = groups.get("");
    if (rest)
      folders.push({
        id: "",
        label: "Other",
        labelKey: "taskFiles.groupOther",
        paths: [...rest].sort(),
        tint: rootTint,
      });
    return folders;
  }

  if (groupBy === "types") {
    for (const file of files)
      bucket(groups, fileExtension(file.path), file.path);
    return trailing(
      [...groups.entries()]
        .map(([id, paths]) => ({
          id,
          label: id || "No extension",
          ...(id ? {} : { labelKey: "taskFiles.groupNoExtension" }),
          paths: [...paths].sort(),
          tint: paletteTint(id || "none"),
        }))
        .sort(
          (a, b) => b.paths.length - a.paths.length || a.id.localeCompare(b.id),
        ),
    );
  }

  for (const file of files) bucket(groups, file.folder, file.path);
  return [...groups.entries()]
    .map(([id, paths]) => ({
      id,
      label: folderLabel(id),
      paths: [...paths].sort(),
      tint: filesByPath.get(paths[0])?.tint ?? rootTint,
    }))
    .sort(
      (a, b) => b.paths.length - a.paths.length || a.id.localeCompare(b.id),
    );
}

export function taskLabel(task: Task): string {
  return `${taskIdLabel(task.referenceId)} ${task.name}`;
}

export function commitUrls(tasks: readonly Task[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const task of tasks)
    for (const url of task.commitUrls)
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
  return urls;
}

export type CommitTask = { id: string; label: string };

export function commitTasks(tasks: readonly Task[]): Map<string, CommitTask> {
  const owners = new Map<string, CommitTask>();
  for (const task of tasks)
    for (const url of task.commitUrls)
      if (!owners.has(url))
        owners.set(url, { id: task.id, label: taskLabel(task) });
  return owners;
}

export function taskFilesModel(
  state: Workspace,
  task: Task,
  commits: readonly CommitFilesResult[],
  options: FilesModelOptions = {},
): TaskFilesModel {
  return filesModel(state, commits, taskLabel(task), undefined, options);
}

export function filesModel(
  state: Workspace,
  commits: readonly CommitFilesResult[],
  label: string,
  owners?: ReadonlyMap<string, CommitTask>,
  options: FilesModelOptions = {},
): TaskFilesModel {
  const groupBy = options.groupBy ?? defaultGroupBy;
  const scope =
    options.projectId && options.projectId !== "all" ? options.projectId : null;
  /* Oldest first while the files are merged, so a rename chain is walked the
     way it happened; the timeline below hands the newest back on top. */
  const chronological = [...commits].sort((a, b) =>
    (a.committedAt ?? "").localeCompare(b.committedAt ?? ""),
  );
  const order = new Map<string, number>();
  for (const [index, result] of chronological.entries())
    if (!result.error && !order.has(result.ref.sha))
      order.set(result.ref.sha, index);
  const merged = new Map<string, Omit<TaskFile, "tint">>();
  const mergeShas = (...groups: readonly string[][]) =>
    [...new Set(groups.flat())].sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0),
    );

  for (const result of chronological) {
    if (result.error) continue;
    for (const file of result.files) {
      const previous = file.previousPath
        ? merged.get(file.previousPath)
        : undefined;
      const current = merged.get(file.path);
      if (file.previousPath && file.previousPath !== file.path)
        merged.delete(file.previousPath);
      const shas = mergeShas(previous?.shas ?? [], current?.shas ?? [], [
        result.ref.sha,
      ]);
      merged.set(file.path, {
        path: file.path,
        folder: folderOf(file.path),
        name: fileName(file.path),
        status: file.status,
        additions:
          (previous?.additions ?? 0) +
          (current && current !== previous ? current.additions : 0) +
          file.additions,
        deletions:
          (previous?.deletions ?? 0) +
          (current && current !== previous ? current.deletions : 0) +
          file.deletions,
        commits: shas.length,
        shas,
        projectId: null,
      });
    }
  }

  const projectColors = new Map(
    state.projects.map((project) => [project.id, project.color]),
  );
  const placed = [...merged.values()]
    .map((file) => {
      const ref = fileCommitRef({ commits: chronological }, file);
      const repository = ref
        ? `https://github.com/${ref.owner}/${ref.repo}`
        : "";
      return {
        ...file,
        projectId: fileProject(file.path, repository, state),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const tints = folderTints(placed, projectColors);
  const all: TaskFile[] = placed.map((file) => ({
    ...file,
    tint:
      (file.projectId ? projectColors.get(file.projectId) : undefined) ??
      tints.get(topFolder(file.path)) ??
      rootTint,
  }));
  const files = scope ? all.filter((file) => file.projectId === scope) : all;
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const folders = groupedFolders(groupBy, files, state, filesByPath);

  const pathsBySha = new Map<string, string[]>();
  for (const file of files)
    for (const sha of file.shas) {
      const paths = pathsBySha.get(sha);
      if (paths) paths.push(file.path);
      else pathsBySha.set(sha, [file.path]);
    }
  const kept = scope ? new Set(files.map((file) => file.path)) : null;
  const changed = (result: CommitFilesResult, key: "additions" | "deletions") =>
    result.files?.reduce(
      (sum, file) => (kept && !kept.has(file.path) ? sum : sum + file[key]),
      0,
    ) ?? 0;
  const timeline: TaskCommit[] = chronological
    .map((result) => {
      const owner = owners?.get(result.ref.url);
      return {
        ref: result.ref,
        paths: pathsBySha.get(result.ref.sha) ?? [],
        additions: changed(result, "additions"),
        deletions: changed(result, "deletions"),
        ...(result.committedAt ? { committedAt: result.committedAt } : {}),
        ...(result.error ? { error: result.error } : {}),
        ...(owner ? { title: owner.label, taskId: owner.id } : {}),
      };
    })
    .filter((commit) => !scope || commit.paths.length > 0);
  timeline.reverse();
  const inScope = new Set(timeline.map((commit) => commit.ref.sha));
  const visible = (result: CommitFilesResult) =>
    !scope || inScope.has(result.ref.sha);
  const loaded = chronological.filter(
    (result) => !result.error && visible(result),
  );
  const failed = chronological.filter(
    (result) => !!result.error && visible(result),
  );

  return {
    label,
    groupBy,
    commits: chronological,
    loaded,
    failed,
    timeline,
    latest: timeline.find((commit) => !commit.error) ?? null,
    files,
    filesByPath,
    folders,
    projects: new Map(state.projects.map((project) => [project.id, project])),
    projectColors,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function blobUrl(ref: CommitRef, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${ref.owner}/${ref.repo}/blob/${ref.sha}/${encodedPath}`;
}

export function fileCommitRef(
  model: Pick<TaskFilesModel, "commits">,
  file: Pick<TaskFile, "shas">,
): CommitRef | null {
  for (let index = file.shas.length - 1; index >= 0; index -= 1) {
    const sha = file.shas[index];
    const match = model.commits.find((result) => result.ref.sha === sha);
    if (match) return match.ref;
  }
  return null;
}

export function fileCommitRefAt(
  model: Pick<TaskFilesModel, "commits">,
  file: Pick<TaskFile, "shas">,
  sha: string | null,
): CommitRef | null {
  if (sha && file.shas.includes(sha)) {
    const match = model.commits.find((result) => result.ref.sha === sha);
    if (match) return match.ref;
  }
  return fileCommitRef(model, file);
}
