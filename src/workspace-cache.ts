import { parseWorkspace, type Workspace } from "./domain";
import { removeLegacyDemoContent } from "./workspace-default";

/* A phone gives a tab a hard ceiling and takes the tab back when it is passed.
   The cache exists to open an account without waiting for the network, and a
   workspace whose history has outgrown that ceiling cannot do it: reading it
   costs the string and the object it becomes at once, before anything is on
   screen. Past this size a workspace is not cached at all and the account opens
   from the server, the way it did the first time. */
export const CACHE_LIMIT = 1_500_000;

export type CacheRole = "owner" | "collaborator";
export type CachedWorkspace = {
  id: string;
  role?: CacheRole;
  workspace: Workspace;
};
export type CacheRead = {
  activeId: string;
  workspaces: CachedWorkspace[];
  /** The index still held the documents, so the caller owes a write. */
  carried: boolean;
  /** Something saved could not be read; keep it for recovery before writing. */
  unreadable: boolean;
};
type StoredIndex = {
  activeId: string;
  workspaces: { id: string; role?: CacheRole; data?: Workspace }[];
};

export function documentKey(key: string, id: string): string {
  return `${key}.w.${id}`;
}

export function documentKeys(key: string): string[] {
  const prefix = `${key}.w.`;
  const names: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const name = localStorage.key(index);
    if (name?.startsWith(prefix) && !name.includes(".recovery."))
      names.push(name);
  }
  return names;
}

export function readCache(key: string): CacheRead {
  const empty: CacheRead = {
    activeId: "",
    workspaces: [],
    carried: false,
    unreadable: false,
  };
  const raw = localStorage.getItem(key);
  if (!raw) return empty;
  /* One string that held every workspace of the account, whole. Reading it is
     the one thing that has to happen before the account can be shown, and on a
     phone it was enough to lose the tab. It is dropped rather than read: the
     server holds the same data, and the next write leaves the shape that fits. */
  if (raw.length > CACHE_LIMIT) {
    localStorage.removeItem(key);
    return empty;
  }
  let stored: StoredIndex;
  try {
    stored = JSON.parse(raw) as StoredIndex;
  } catch {
    return { ...empty, unreadable: true };
  }
  if (!Array.isArray(stored.workspaces) || !stored.workspaces.length)
    return empty;
  const workspaces: CachedWorkspace[] = [];
  let carried = false;
  let unreadable = false;
  for (const entry of stored.workspaces) {
    if (!entry?.id) continue;
    let data: unknown = entry.data;
    if (data !== undefined) carried = true;
    else {
      const document = localStorage.getItem(documentKey(key, entry.id));
      if (!document || document.length > CACHE_LIMIT) continue;
      try {
        data = JSON.parse(document);
      } catch {
        unreadable = true;
        continue;
      }
    }
    try {
      workspaces.push({
        id: entry.id,
        role: entry.role,
        workspace: removeLegacyDemoContent(parseWorkspace(data)),
      });
    } catch {
      unreadable = true;
    }
  }
  return {
    activeId: typeof stored.activeId === "string" ? stored.activeId : "",
    workspaces,
    carried,
    unreadable,
  };
}

export function writeCache(
  key: string,
  activeId: string,
  items: readonly CachedWorkspace[],
): void {
  const kept: CachedWorkspace[] = [];
  for (const item of items) {
    const text = JSON.stringify(item.workspace);
    if (text.length > CACHE_LIMIT) {
      localStorage.removeItem(documentKey(key, item.id));
      continue;
    }
    localStorage.setItem(documentKey(key, item.id), text);
    kept.push(item);
  }
  const index: StoredIndex = {
    activeId,
    workspaces: kept.map(({ id, role }) => ({ id, ...(role ? { role } : {}) })),
  };
  localStorage.setItem(key, JSON.stringify(index));
  const wanted = new Set(kept.map((item) => documentKey(key, item.id)));
  for (const name of documentKeys(key))
    if (!wanted.has(name)) localStorage.removeItem(name);
}

export function preserveCache(key: string, stamp: number): void {
  for (const name of [key, ...documentKeys(key)]) {
    const original = localStorage.getItem(name);
    if (original) localStorage.setItem(`${name}.recovery.${stamp}`, original);
  }
}
