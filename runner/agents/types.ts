import type { Screen } from "../screen.ts";

export type AgentKind = "claude" | "codex";

export type RateLimits = Record<string, unknown>;

export type AgentStatus = {
  costUsd?: number;
  durationMs?: number;
  model?: string;
  rateLimits?: RateLimits;
};

export type AgentResult = {
  ok: boolean;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  model?: string;
  sessionId?: string;
  summary?: string;
  error?: string;
  rateLimits?: RateLimits;
};

export type McpProxy = {
  name: string;
  command: string;
  args: string[];
  configPath: string;
};

export type AgentOptions = {
  prompt: string;
  cwd: string;
  /** The repository the worktree was cut from. A linked worktree keeps its
   *  index, its HEAD and the objects a commit writes inside the parent's .git,
   *  which is nowhere near the folder the agent was given. */
  repo?: string;
  model?: string;
  agentName: string;
  mcp: McpProxy;
  trustWorktree?: boolean;
  onLine: (text: string) => void;
  onStatus?: (status: AgentStatus) => void;
  /** The step the agent is on and the files it has touched, where the agent
   *  reports them through hooks (Claude); never asked of the model. */
  onActivity?: (activity: {
    step: string;
    edited: string[];
    read: string[];
  }) => void;
};

export type PtyLink = {
  write: (data: string) => void;
  resize: (columns: number, rows: number) => void;
  onData: (listen: (data: string) => void) => () => void;
};

export type PtySession = PtyLink & {
  onExit: (listen: (code: number) => void) => () => void;
  alive: () => boolean;
  kill: () => void;
};

export type AgentRun = {
  done: Promise<AgentResult>;
  stop: () => void;
  pty?: PtyLink;
  screen?: Screen;
};

export type AgentDriver = {
  kind: AgentKind;
  command: string;
  start: (options: AgentOptions) => AgentRun;
};

export function short(value: unknown, limit = 160): string {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

export function executable(command: string, platform = process.platform) {
  return platform === "win32" ? command + ".cmd" : command;
}

export function quoted(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? `"${value.replace(/"/g, '\\"')}"`
    : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
