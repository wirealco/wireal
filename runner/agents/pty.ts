import { win32 } from "node:path";
import { spawn } from "node-pty";
import { resolveProgram } from "../hosts.ts";
import { executable, type PtySession } from "./types.ts";

export const defaultColumns = 120;
export const defaultRows = 40;

export type PtyOptions = {
  command: string;
  args: string[];
  cwd: string;
  eventsPath: string;
  agentName: string;
  env?: Record<string, string>;
  columns?: number;
  rows?: number;
  platform?: NodeJS.Platform;
};

export const hostMarkers = [
  "CLAUDECODE",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
];

export function ptyEnvironment(
  options: PtyOptions,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(base))
    if (typeof value === "string" && !hostMarkers.includes(key))
      environment[key] = value;
  return {
    ...environment,
    ...options.env,
    WIREAL_AGENT_EVENTS: options.eventsPath,
    WIREAL_AGENT_NAME: options.agentName,
  };
}

export function launch(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  find: (name: string) => string = (name) => resolveProgram(name),
  shell = process.env.ComSpec || "cmd.exe",
): { file: string; args: string[] } {
  if (platform !== "win32") return { file: command, args };
  // A path given whole (WIREAL_CODEX_PATH, say) is taken as it is.
  const program = win32.isAbsolute(command)
    ? command
    : find(command) || executable(command, platform);
  return /\.(cmd|bat)$/i.test(program)
    ? { file: shell, args: ["/d", "/s", "/c", program, ...args] }
    : { file: program, args };
}

export function startPty(options: PtyOptions): PtySession {
  const started = launch(
    options.command,
    options.args,
    options.platform ?? process.platform,
  );
  const child = spawn(started.file, started.args, {
    name: "xterm-256color",
    cols: options.columns ?? defaultColumns,
    rows: options.rows ?? defaultRows,
    cwd: options.cwd,
    env: ptyEnvironment(options),
  });
  let running = true;
  const data = new Set<(chunk: string) => void>();
  const exit = new Set<(code: number) => void>();
  child.onData((chunk) => {
    for (const listen of [...data]) listen(chunk);
  });
  child.onExit(({ exitCode }) => {
    running = false;
    for (const listen of [...exit]) listen(exitCode);
    data.clear();
    exit.clear();
  });
  return {
    write: (chunk) => {
      if (running) child.write(chunk);
    },
    resize: (columns, rows) => {
      if (!running) return;
      try {
        child.resize(Math.max(20, columns), Math.max(5, rows));
      } catch {
        return;
      }
    },
    onData: (listen) => {
      data.add(listen);
      return () => data.delete(listen);
    },
    onExit: (listen) => {
      exit.add(listen);
      return () => exit.delete(listen);
    },
    alive: () => running,
    kill: () => {
      if (!running) return;
      try {
        child.kill();
      } catch {
        return;
      }
    },
  };
}

const escape = String.fromCharCode(27);
const bell = String.fromCharCode(7);
const ansi = new RegExp(
  [
    `${escape}\\[[0-9;?<>=!]*[ -/]*[@-~]`,
    `${escape}\\][^${bell}${escape}]*(?:${bell}|${escape}\\\\)`,
    `${escape}[()][0-9A-B]`,
    `${escape}[=>78MDEHc]`,
    "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]",
  ].join("|"),
  "g",
);

export function plain(chunk: string): string {
  return chunk.replace(ansi, "");
}

export function squeezed(chunk: string): string {
  return plain(chunk).replace(/\s+/g, "").toLowerCase();
}
