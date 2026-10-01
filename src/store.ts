import { useSyncExternalStore } from "react";
import {
  parseWorkspace,
  uid,
  type MapSettings,
  type Workspace,
} from "./domain";
import { emptyWorkspace, removeLegacyDemoContent } from "./workspace-default";
import { preserveCache, readCache, writeCache } from "./workspace-cache";
import { trace } from "./boot-trace";
import { localWorkspaceId } from "./workspace-id";
import { backend } from "./backend";

// The product was called Thread before it was Wireal. Browsers that used it
// still hold their local workspace under this key, so it is read and kept.
const LEGACY_KEY = "thread.workspace.v1";
const CATALOG_KEY = "wireal.workspaces.v2";
const userKey = (id: string) => `${CATALOG_KEY}.user.${id}`;

export type WorkspaceInfo = {
  role?: "owner" | "collaborator";
  id: string;
  name: string;
  repositoryUrl: string;
  workspace: Workspace;
};
type WorkspaceRow = {
  role?: WorkspaceInfo["role"];
  id: string;
  data: unknown;
  is_active: boolean;
  revision: number;
};
export type ConnectResult = { ok: boolean; cached: boolean; message?: string };
export type WorkspaceAvailability = "loading" | "none" | "ready";

let state = emptyWorkspace();
let activeId = localWorkspaceId;
let catalog: WorkspaceInfo[] = [];
let error = "";
let unreadable = false;
let remoteUserId: string | null = null;
let carried: Workspace | null = null;
let loaded = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let stopWatching: (() => void) | undefined;
const revisions = new Map<string, number>();
const dirty = new Map<string, Workspace>();
let syncing: Promise<void> = Promise.resolve();
let past: Workspace[] = [];
let future: Workspace[] = [];
const listeners = new Set<() => void>();

function info(
  id: string,
  workspace: Workspace,
  role?: WorkspaceInfo["role"],
): WorkspaceInfo {
  return {
    role,
    id,
    name: workspace.map.name,
    repositoryUrl: workspace.map.repositoryUrl,
    workspace,
  };
}
function emit() {
  for (const listener of listeners) listener();
}
function storageKey() {
  return remoteUserId ? userKey(remoteUserId) : CATALOG_KEY;
}
function saveLocal() {
  try {
    writeCache(storageKey(), activeId, catalog);
    if (!remoteUserId) localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
    error = "";
  } catch {
    error =
      "Browser storage is unavailable. Changes will still be sent to Wireal while this tab is open.";
  }
}
function install(items: WorkspaceInfo[], selected?: string) {
  catalog = items;
  activeId = items.some((item) => item.id === selected)
    ? selected!
    : (items[0]?.id ?? "");
  state =
    items.find((item) => item.id === activeId)?.workspace ?? emptyWorkspace();
  past = [];
  future = [];
}
function readStored(key: string): boolean {
  const cached = readCache(key);
  trace("cache held", { workspaces: cached.workspaces.length });
  if (cached.unreadable) {
    unreadable = true;
    error =
      "Saved data could not be loaded. The original will be preserved for recovery.";
  }
  if (!cached.workspaces.length) return false;
  install(
    cached.workspaces.map((item) => info(item.id, item.workspace, item.role)),
    cached.activeId,
  );
  if (cached.carried) saveLocal();
  return true;
}

try {
  if (!readStored(CATALOG_KEY)) {
    const legacy = localStorage.getItem(LEGACY_KEY);
    const workspace = legacy
      ? removeLegacyDemoContent(parseWorkspace(legacy))
      : emptyWorkspace();
    install([info(localWorkspaceId, workspace)], localWorkspaceId);
    saveLocal();
  }
} catch {
  install([info(localWorkspaceId, emptyWorkspace())], localWorkspaceId);
  unreadable = true;
  error =
    "Saved data could not be loaded. The original will be preserved for recovery.";
}

async function syncRemote(
  snapshot: Workspace,
  userId: string,
  workspaceId: string,
) {
  if (!backend || remoteUserId !== userId) return;
  const { data, error: syncError } = await backend
    .from("workspaces")
    .update({
      data: snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workspaceId)
    .eq("revision", revisions.get(workspaceId) ?? -1)
    .select("revision")
    .maybeSingle<{ revision: number }>();
  if (remoteUserId !== userId) return;
  if (syncError || !data) {
    error = `Cloud sync failed: ${syncError?.message ?? "This workspace changed in another client. Your local changes are preserved; export them before reloading."}`;
    emit();
    throw new Error(error);
  }
  revisions.set(workspaceId, data.revision);
  /* The snapshot this call carried is the object persist() put in the map. An
     edit during the round trip replaces it with another, so the reference
     answers "did anything change while this was in flight" without reading a
     word of either document. */
  if (dirty.get(workspaceId) === snapshot) dirty.delete(workspaceId);
  error = "";
  emit();
}

async function flushRemote() {
  const userId = remoteUserId;
  if (!userId) return;
  clearTimeout(syncTimer);
  const work = syncing
    .catch(() => undefined)
    .then(async () => {
      for (const [id, snapshot] of dirty)
        await syncRemote(snapshot, userId, id);
    });
  syncing = work;
  return work;
}

function persist() {
  catalog = catalog.map((item) =>
    item.id === activeId ? info(activeId, state, item.role) : item,
  );
  if (unreadable) {
    preserveCache(storageKey(), Date.now());
    unreadable = false;
  }
  saveLocal();
  if (remoteUserId && loaded && activeId) {
    const workspaceId = activeId;
    const snapshot = structuredClone(state);
    dirty.set(workspaceId, snapshot);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(
      () => void flushRemote().catch(() => undefined),
      250,
    );
  }
  emit();
}

function carriesLocalWork(): boolean {
  return (
    activeId === localWorkspaceId &&
    (state.tasks.length > 0 || state.projects.length > 0)
  );
}

async function loadRemote(userId: string) {
  if (!backend) return;
  const { data, error: loadError } = await backend
    .from("workspaces")
    .select("id,data,is_active,revision,role")
    .order("created_at", { ascending: true });
  trace("query done", { rows: Array.isArray(data) ? data.length : 0 });
  if (remoteUserId !== userId) return;
  if (loadError) throw loadError;
  const rows = (data ?? []) as WorkspaceRow[];
  // A removed teammate must not keep editing or re-upload a revoked workspace,
  // even when their tab has pending changes. Preserve edits to accessible ones.
  const visible = new Set(rows.map((row) => row.id));
  for (const id of dirty.keys()) if (!visible.has(id)) dirty.delete(id);
  for (const id of revisions.keys()) if (!visible.has(id)) revisions.delete(id);
  const retained = catalog.filter((item) => visible.has(item.id));
  if (
    retained.length !== catalog.length &&
    catalog.some((item) => item.id !== localWorkspaceId)
  ) {
    install(retained, activeId);
    saveLocal();
    emit();
  }
  if (loaded && dirty.size) return;
  if (!rows.length) {
    if (carried) {
      const workspace = carried;
      const id = uid();
      const inserted = await backend
        .from("workspaces")
        .insert({ id, user_id: userId, data: workspace, is_active: true });
      if (inserted.error) throw inserted.error;
      revisions.set(id, 1);
      install([info(id, workspace, "owner")], id);
    } else install([]);
  } else {
    /* The revision is the database's own count of what it has written, so two
       loads at the same revision carry the same document. Comparing the numbers
       says what comparing the serialized catalogs used to say, without building
       a copy of every workspace to throw away. A workspace read from the cache
       has no revision yet, which reads as changed — the cache may be behind,
       and installing is the right answer. */
    const seen = new Map(revisions);
    for (const row of rows) revisions.set(row.id, row.revision);
    const selected = rows.find((row) => row.is_active)?.id;
    const unchanged =
      selected === activeId &&
      rows.length === catalog.length &&
      rows.every(
        (row, index) =>
          catalog[index]?.id === row.id &&
          (catalog[index]?.role ?? null) === (row.role ?? null) &&
          seen.get(row.id) === row.revision,
      );
    if (!unchanged)
      install(
        rows.map((row) =>
          info(
            row.id,
            removeLegacyDemoContent(parseWorkspace(row.data)),
            row.role,
          ),
        ),
        selected,
      );
    if (rows.find((row) => row.is_active)?.id !== activeId) {
      const activated = await backend.rpc("set_active_workspace", {
        target_workspace_id: activeId,
      });
      if (activated.error) throw activated.error;
    }
  }
  carried = null;
  loaded = true;
  saveLocal();
  emit();
  trace("loaded", { active: activeId.slice(0, 8) });
}

function openCached(userId: string): boolean {
  carried = carriesLocalWork() ? state : null;
  remoteUserId = userId;
  error = "";
  clearTimeout(syncTimer);
  stopWatching?.();
  stopWatching = undefined;
  revisions.clear();
  dirty.clear();
  const hadCache = readStored(userKey(userId));
  if (!hadCache) install([]);
  loaded = hadCache;
  emit();
  return hadCache;
}

export const repository = {
  get: () => state,
  getWorkspaces: () => catalog,
  getActiveWorkspaceId: () => activeId,
  getAvailability: (): WorkspaceAvailability =>
    catalog.length ? "ready" : remoteUserId && !loaded ? "loading" : "none",
  getError: () => error,
  flush: flushRemote,
  refresh: async () => {
    if (remoteUserId) await loadRemote(remoteUserId);
  },
  reportError: (message: string) => {
    error = message;
    emit();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open: (userId: string) => {
    if (!backend) return false;
    return openCached(userId);
  },
  /**
   * Reports whether the account's own workspaces were reached. A failure with a
   * cache behind it is recoverable — the last copy of this user's cloud data is
   * still theirs, and the next successful load replaces it. A failure without
   * one leaves the account holding nothing, which is indistinguishable from an
   * account that genuinely owns no workspace — and the two want opposite
   * screens. The caller is expected to refuse to open the workspace in that
   * case rather than read the empty catalog as an answer.
   */
  connect: async (userId: string): Promise<ConnectResult> => {
    if (!backend) return { ok: true, cached: false };
    const hadCache = remoteUserId === userId ? loaded : openCached(userId);
    let result: ConnectResult = { ok: true, cached: hadCache };
    try {
      await loadRemote(userId);
    } catch (loadError) {
      error = `Cloud workspaces could not be loaded: ${loadError instanceof Error ? loadError.message : String(loadError)}`;
      if (!hadCache) install([]);
      result = { ok: false, cached: hadCache, message: error };
      emit();
    }
    stopWatching?.();
    stopWatching = backend.watchWorkspaces(() => {
      // Realtime follows the database's active flag. Passing this tab's old ID
      // during a switch could otherwise race the RPC and switch it back.
      if (remoteUserId === userId)
        void loadRemote(userId)
          .then(() => (dirty.size ? flushRemote() : undefined))
          .catch(() => undefined);
    });
    return result;
  },
  disconnect: () => {
    remoteUserId = null;
    carried = null;
    loaded = false;
    clearTimeout(syncTimer);
    stopWatching?.();
    stopWatching = undefined;
    revisions.clear();
    dirty.clear();
    install([info(localWorkspaceId, emptyWorkspace())], localWorkspaceId);
    error = "";
    emit();
  },
  createWorkspace: async (map: MapSettings) => {
    const blank = emptyWorkspace();
    // A new workspace starts from the settings the dialog collected — name,
    // repository and orb — not from a name with defaults filled in later.
    const workspace = {
      ...blank,
      map: { ...blank.map, ...map, name: map.name.trim() || "Workspace" },
    };
    const id = uid();
    if (backend && remoteUserId) {
      await flushRemote();
      const { error: insertError } = await backend.from("workspaces").insert({
        id,
        user_id: remoteUserId,
        data: workspace,
        is_active: false,
      });
      if (insertError) throw insertError;
      const { error: activeError } = await backend.rpc("set_active_workspace", {
        target_workspace_id: id,
      });
      if (activeError) throw activeError;
      await loadRemote(remoteUserId);
      return id;
    }
    catalog = [...catalog, info(id, workspace)];
    activeId = id;
    state = workspace;
    past = [];
    future = [];
    saveLocal();
    emit();
    return id;
  },
  switchWorkspace: async (id: string) => {
    const target = catalog.find((item) => item.id === id);
    if (!target || id === activeId) return;
    clearTimeout(syncTimer);
    if (backend && remoteUserId) {
      await flushRemote();
      const { error: activeError } = await backend.rpc("set_active_workspace", {
        target_workspace_id: id,
      });
      if (activeError) throw activeError;
      await loadRemote(remoteUserId);
      return;
    }
    activeId = id;
    state = target.workspace;
    past = [];
    future = [];
    saveLocal();
    emit();
  },
  deleteWorkspace: async (id: string) => {
    const remaining = catalog.filter((item) => item.id !== id);
    const nextId = id === activeId ? (remaining[0]?.id ?? "") : activeId;
    if (backend && remoteUserId) {
      await flushRemote();
      const { error: deleteError } = await backend
        .from("workspaces")
        .delete()
        .eq("id", id);
      if (deleteError) throw deleteError;
      revisions.delete(id);
      if (id === activeId && nextId) {
        const { error: activeError } = await backend.rpc(
          "set_active_workspace",
          { target_workspace_id: nextId },
        );
        if (activeError) throw activeError;
      }
      await loadRemote(remoteUserId);
      return;
    }
    if (!remaining.length) throw new Error("Keep at least one workspace.");
    catalog = remaining;
    activeId = nextId;
    state = catalog.find((item) => item.id === activeId)!.workspace;
    past = [];
    future = [];
    saveLocal();
    emit();
  },
  commit: (change: (current: Workspace) => Workspace) => {
    if (remoteUserId && !activeId) return;
    const next = change(state);
    if (next === state) return;
    past = [...past.slice(-49), state];
    state = next;
    future = [];
    persist();
  },
  undo: () => {
    const previous = past.pop();
    if (previous) {
      future.push(state);
      state = previous;
      persist();
    }
  },
  redo: () => {
    const next = future.pop();
    if (next) {
      past.push(state);
      state = next;
      persist();
    }
  },
  canUndo: () => past.length > 0,
  canRedo: () => future.length > 0,
};

export const useWorkspace = () =>
  useSyncExternalStore(repository.subscribe, repository.get);
export const useWorkspaces = () =>
  useSyncExternalStore(repository.subscribe, repository.getWorkspaces);
export const useWorkspaceAvailability = () =>
  useSyncExternalStore(repository.subscribe, repository.getAvailability);
export const useSyncError = () =>
  useSyncExternalStore(repository.subscribe, repository.getError);
