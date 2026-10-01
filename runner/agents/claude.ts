import {
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDirectory } from "../session.ts";
import { activityOf, lifecycleOf, readEvents, statusOf } from "./events.ts";
import { defaultColumns, defaultRows, squeezed, startPty } from "./pty.ts";
import {
  quoted,
  short,
  type AgentDriver,
  type AgentOptions,
  type AgentResult,
  type AgentRun,
  type PtySession,
} from "./types.ts";

export type PermissionEvent = "PermissionRequest" | "PreToolUse";

export const hooksDirectory = fileURLToPath(
  new URL("../hooks/", import.meta.url),
);

export function hookScript(name: string): string {
  return join(hooksDirectory, name);
}

export function claudeSettings(
  event: PermissionEvent,
  node = process.execPath,
  platform: NodeJS.Platform = process.platform,
): Record<string, unknown> {
  const run = (script: string, argument?: string) =>
    `${quoted(node, platform)} ${quoted(hookScript(script), platform)}${argument ? ` ${argument}` : ""}`;
  const once = (command: string) => [{ hooks: [{ type: "command", command }] }];
  return {
    tui: "default",
    statusLine: { type: "command", command: run("statusline.cjs") },
    hooks: {
      Stop: once(run("event.cjs", "Stop")),
      SessionEnd: once(run("event.cjs", "SessionEnd")),
      // Records the tool call for the runner and, only when something that
      // concerns this agent changed among its peers, adds up to three lines.
      UserPromptSubmit: once(run("peers.cjs", "UserPromptSubmit")),
      PostToolUse: [
        {
          matcher: "*",
          hooks: [
            { type: "command", command: run("peers.cjs", "PostToolUse") },
          ],
        },
      ],
      [event]: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: run("permission.cjs") }],
        },
      ],
    },
  };
}

export function claudeArgs(
  options: AgentOptions,
  settingsPath: string,
): string[] {
  return [
    options.prompt,
    "--settings",
    settingsPath,
    "--mcp-config",
    options.mcp.configPath,
    "--strict-mcp-config",
    ...(options.model ? ["--model", options.model] : []),
  ];
}

export function supportsPermissionRequest(program: string): boolean {
  const needle = Buffer.from("PermissionRequest");
  const overlap = needle.length - 1;
  let handle: number | undefined;
  try {
    handle = openSync(program, "r");
    const size = 1 << 20;
    const buffer = Buffer.alloc(overlap + size);
    let carried = 0;
    for (;;) {
      const read = readSync(handle, buffer, carried, size, null);
      if (read <= 0) return false;
      const filled = carried + read;
      if (buffer.subarray(0, filled).includes(needle)) return true;
      carried = Math.min(overlap, filled);
      buffer.copy(buffer, 0, filled - carried, filled);
    }
  } catch {
    return false;
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
}

let cachedEvent: PermissionEvent | undefined;

export function permissionEvent(
  program = process.env.WIREAL_CLAUDE_PATH || "",
): PermissionEvent {
  if (cachedEvent) return cachedEvent;
  cachedEvent =
    program && supportsPermissionRequest(program)
      ? "PermissionRequest"
      : "PreToolUse";
  return cachedEvent;
}

export const trustQuestion = "yes,itrustthisfolder";
export const noticeFooter = ["entertoconfirm", "esctocancel"];
const trustAnswer = "\u001b[B\r";
const dismiss = "\u001b";
const exitCommand = "/exit";
const enter = "\r";

export function dialogOf(screen: string): "trust" | "notice" | "none" {
  const text = squeezed(screen);
  if (text.includes(trustQuestion)) return "trust";
  return noticeFooter.every((part) => text.includes(part)) ? "notice" : "none";
}

export const answerAfter = 1500;

export type ClaudeParts = {
  folder: string;
  event: PermissionEvent;
  open: (files: { settings: string; events: string }) => PtySession;
  poll: number;
  grace: number;
  answer: number;
};

export function runFolder(): string {
  const folder = join(configDirectory(), "runs");
  mkdirSync(folder, { recursive: true });
  return folder;
}

export function startClaude(
  options: AgentOptions,
  parts: Partial<ClaudeParts> = {},
): AgentRun {
  const folder = parts.folder ?? runFolder();
  const event = parts.event ?? permissionEvent(programPath());
  const poll = parts.poll ?? 500;
  const grace = parts.grace ?? 10_000;
  const answer = parts.answer ?? answerAfter;
  const later = (write: () => void) => {
    if (answer <= 0) return write();
    setTimeout(write, answer).unref?.();
  };
  const stem = `${process.pid}-${options.agentName.replace(/\W+/g, "")}-${Date.now()}`;
  const events = join(folder, `events-${stem}.jsonl`);
  const settings = join(folder, `settings-${stem}.json`);
  writeFileSync(events, "");
  writeFileSync(settings, JSON.stringify(claudeSettings(event), null, 2));

  const session =
    parts.open?.({ settings, events }) ??
    startPty({
      command: "claude",
      args: claudeArgs(options, settings),
      cwd: options.cwd,
      eventsPath: events,
      agentName: options.agentName,
      columns: defaultColumns,
      rows: defaultRows,
      env: {
        WIREAL_AGENT_WORKTREE: options.cwd,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    });

  let screen = "";
  let trust: "unseen" | "answered" | "refused" = "unseen";
  let seen = 0;
  let exiting = false;
  let killer: NodeJS.Timeout | undefined;
  let result: AgentResult = { ok: false, error: "The agent never reported." };
  let settled = false;

  const dropData = session.onData((chunk) => {
    screen = (screen + chunk).slice(-8000);
    const dialog = dialogOf(screen);
    if (dialog === "none") return;
    screen = "";
    if (dialog === "notice") {
      options.onLine("dismissed a Claude Code notice");
      later(() => session.write(dismiss));
      return;
    }
    if (trust !== "unseen") return;
    if (options.trustWorktree !== true) {
      trust = "refused";
      result = {
        ok: false,
        error: `Claude Code does not trust ${options.cwd}. The runner answers its folder question unless it was started with --ask-trust; or run claude once in the repository and accept the folder.`,
      };
      options.onLine("the folder is not trusted");
      session.kill();
      return;
    }
    trust = "answered";
    options.onLine("accepted the folder trust dialog");
    later(() => session.write(trustAnswer));
  });

  let reported = "";
  let acted = "";
  const drain = () => {
    const all = readEvents(events);
    const status = statusOf(all);
    const shape = JSON.stringify(status);
    if (shape !== "{}" && shape !== reported) {
      reported = shape;
      options.onStatus?.(status);
    }
    const activity = activityOf(all, options.cwd);
    const moved = JSON.stringify(activity);
    if (activity.step && moved !== acted) {
      acted = moved;
      options.onActivity?.(activity);
    }
    const life = lifecycleOf(all);
    for (const line of life.lines.slice(seen)) options.onLine(line);
    seen = life.lines.length;
    if (life.stopped && !exiting) {
      exiting = true;
      options.onLine("finished, leaving the session");
      session.write(exitCommand);
      later(() => session.write(enter));
      killer = setTimeout(() => session.kill(), grace);
      killer.unref?.();
    }
    return { status, life };
  };

  const timer = setInterval(drain, poll);
  timer.unref?.();

  const done = new Promise<AgentResult>((resolve) => {
    session.onExit((code) => {
      clearInterval(timer);
      if (killer) clearTimeout(killer);
      dropData();
      const { status, life } = drain();
      if (!settled) {
        settled = true;
        result = life.stopped
          ? {
              ok: !life.isError,
              summary: life.summary ? short(life.summary, 480) : undefined,
              error: life.isError
                ? `The session ended: ${life.reason}`
                : undefined,
              ...status,
            }
          : {
              ...result,
              ...status,
              error:
                trust === "refused"
                  ? result.error
                  : result.error ||
                    `Claude Code exited with code ${code} before it finished.`,
            };
      }
      rmSync(settings, { force: true });
      rmSync(events, { force: true });
      resolve(result);
    });
  });

  return {
    done,
    stop: () => session.kill(),
    pty: session,
  };
}

function programPath(): string {
  return process.env.WIREAL_CLAUDE_PATH || whichClaude();
}

let resolvedProgram: string | undefined;

function whichClaude(): string {
  if (resolvedProgram !== undefined) return resolvedProgram;
  resolvedProgram = "";
  const paths = (process.env.PATH ?? "").split(
    process.platform === "win32" ? ";" : ":",
  );
  const names =
    process.platform === "win32" ? ["claude.cmd", "claude.exe"] : ["claude"];
  for (const folder of paths)
    for (const name of names) {
      const candidate = join(folder, name);
      try {
        closeSync(openSync(candidate, "r"));
        resolvedProgram = candidate;
        return resolvedProgram;
      } catch {
        continue;
      }
    }
  return resolvedProgram;
}

export const claude: AgentDriver = {
  kind: "claude",
  command: "claude",
  start: (options) => startClaude(options),
};
