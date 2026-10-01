import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend";
import { remoteWorkspace } from "./workspace-id";
import {
  parseFlowRequest,
  parsePresence,
  parseRunner,
  parseTaskLock,
  runnerPollMs,
  type FlowRequest,
  type Presence,
  type Runner,
  type TaskLock,
} from "./runners";

export async function fetchRunners(): Promise<Runner[]> {
  if (!backend) return [];
  const { data: rows, error } = await backend.from("runners").select("*");
  if (error) throw error;
  return (rows ?? []).map(parseRunner);
}

export async function fetchFlowRequests(
  workspaceId: string,
): Promise<FlowRequest[]> {
  if (!backend || !remoteWorkspace(workspaceId)) return [];
  const { data: rows, error } = await backend
    .from("flow_requests")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return (rows ?? []).map(parseFlowRequest);
}

export async function fetchTaskLocks(workspaceId: string): Promise<TaskLock[]> {
  if (!backend || !remoteWorkspace(workspaceId)) return [];
  const { data: rows, error } = await backend
    .from("task_locks")
    .select("*")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return (rows ?? []).map(parseTaskLock);
}

/** People's own CLI sessions on this workspace. An API that does not know
 *  presence yet answers with an error, which reads as nobody. */
export async function fetchPresence(workspaceId: string): Promise<Presence[]> {
  if (!backend || !remoteWorkspace(workspaceId)) return [];
  try {
    const response = (await backend.rpc("list_presence", {
      workspace_id: workspaceId,
    })) as unknown as { error?: unknown; presence?: unknown[] };
    if (response?.error) return [];
    return (response?.presence ?? []).map(parsePresence);
  } catch {
    return [];
  }
}

export function usePresence(workspaceId: string, intervalMs = runnerPollMs) {
  const [presence, setPresence] = useState<Presence[]>([]);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const rows = await fetchPresence(workspaceId);
      if (alive) setPresence(rows);
    };
    void load();
    const poll = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [workspaceId, intervalMs]);
  return presence;
}

export async function pingRunner(
  workspaceId: string,
  runnerId: string,
): Promise<string> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("ping_runner", {
    workspace_id: workspaceId,
    runner: runnerId,
  })) as unknown as {
    error?: { message?: string } | null;
    ping_requested_at?: string;
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The runner could not be pinged.",
    );
  return response?.ping_requested_at ?? new Date().toISOString();
}

export async function forgetRunner(
  workspaceId: string,
  runnerId: string,
): Promise<boolean> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("forget_runner", {
    workspace_id: workspaceId,
    runner: runnerId,
  })) as unknown as {
    error?: { message?: string } | null;
    forgotten?: boolean;
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The runner could not be forgotten.",
    );
  return response?.forgotten === true;
}

export async function lockTask(
  workspaceId: string,
  taskId: string,
  agent = "",
  line = false,
): Promise<TaskLock[]> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("lock_task", {
    workspace_id: workspaceId,
    task_id: taskId,
    agent,
    line,
  })) as unknown as {
    error?: { message?: string } | null;
    locks?: unknown[];
  };
  if (response?.error)
    throw new Error(response.error.message ?? "The task could not be locked.");
  return (response?.locks ?? []).map(parseTaskLock);
}

export async function unlockTask(
  workspaceId: string,
  taskId: string,
  line = false,
): Promise<string[]> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("unlock_task", {
    workspace_id: workspaceId,
    task_id: taskId,
    line,
  })) as unknown as {
    error?: { message?: string } | null;
    unlocked?: unknown[];
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The task could not be unlocked.",
    );
  return (response?.unlocked ?? []).map((id) => String(id));
}

export async function requestMerge(
  workspaceId: string,
  taskId: string,
): Promise<{ requestId: string; taskId: string }> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("request_merge", {
    workspace_id: workspaceId,
    task_id: taskId,
  })) as unknown as {
    error?: { message?: string } | null;
    request_id?: string;
    task_id?: string;
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The branch could not be merged.",
    );
  return {
    requestId: response?.request_id ?? "",
    taskId: response?.task_id ?? taskId,
  };
}

export async function requestPull(
  workspaceId: string,
  runnerId: string,
): Promise<string> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("request_pull", {
    workspace_id: workspaceId,
    runner: runnerId,
  })) as unknown as {
    error?: { message?: string } | null;
    request_id?: string;
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The folder could not be pulled.",
    );
  return response?.request_id ?? "";
}

export async function requestPromote(
  workspaceId: string,
  runnerId: string,
): Promise<string> {
  if (!backend) throw new Error("Wireal is not connected to the cloud.");
  const response = (await backend.rpc("request_promote", {
    workspace_id: workspaceId,
    runner: runnerId,
  })) as unknown as {
    error?: { message?: string } | null;
    request_id?: string;
  };
  if (response?.error)
    throw new Error(
      response.error.message ?? "The agent branch could not be promoted.",
    );
  return response?.request_id ?? "";
}

export function useFlowRequests(
  workspaceId: string,
  intervalMs = runnerPollMs,
) {
  const [requests, setRequests] = useState<FlowRequest[]>([]);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const pending = await fetchFlowRequests(workspaceId);
      if (alive.current) setRequests(pending);
    } catch {
      if (alive.current) setRequests([]);
    }
  }, [workspaceId]);
  useEffect(() => {
    alive.current = true;
    void load();
    const poll = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load, intervalMs]);
  return { requests, reload: load };
}

export function useTaskLocks(workspaceId: string, intervalMs = runnerPollMs) {
  const [locks, setLocks] = useState<TaskLock[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const rows = await fetchTaskLocks(workspaceId);
      if (!alive.current) return;
      setLocks(rows);
      setError("");
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [workspaceId]);
  useEffect(() => {
    alive.current = true;
    void load();
    const poll = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load, intervalMs]);
  return { locks, error, reload: load };
}

export function useRunners(workspaceId: string, intervalMs = runnerPollMs) {
  const [runners, setRunners] = useState<Runner[]>([]);
  const [requests, setRequests] = useState<FlowRequest[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const [rows, pending] = await Promise.all([
        fetchRunners(),
        fetchFlowRequests(workspaceId),
      ]);
      if (!alive.current) return;
      setRunners(rows);
      setRequests(pending);
      setError("");
    } catch (cause) {
      if (!alive.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (alive.current) setNow(Date.now());
    }
  }, [workspaceId]);
  useEffect(() => {
    alive.current = true;
    void load();
    const poll = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(poll, intervalMs);
    document.addEventListener("visibilitychange", poll);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load, intervalMs]);
  return { runners, requests, error, now, reload: load };
}
