import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { resolveProgram } from "../hosts.ts";
import { apiUrl } from "../session.ts";
import { createScreen, type Screen } from "../screen.ts";
import {
  defaultColumns,
  defaultRows,
  plain,
  squeezed,
  startPty,
} from "./pty.ts";
import {
  findRollout,
  openRollout,
  sessionsDirectory,
  type Rollout,
} from "./rollout.ts";
import {
  short,
  type AgentDriver,
  type AgentOptions,
  type AgentResult,
  type AgentRun,
  type PtyLink,
  type PtySession,
  type RateLimits,
} from "./types.ts";

export const quietMilliseconds = 20_000;
export const trustQuestion = "doyoutrustthecontentsofthisdirectory";
const trustAnswer = "\r";
const exitCommand = "/quit";
const enter = "\r";
const chrome =
  /^[⏎⇧⌃]|ctrl\+[a-z]|esc to |to interrupt|\d+% left|\/(ps|stop) to /i;
const divider = /^\s*[─━═╌╍┄┅┈┉]{20,}\s*$/;

/** The Codex the runner starts: WIREAL_CODEX_PATH when it is set, else the
 *  first codex on PATH. That is not always the one a shell finds: npm run
 *  puts Node's own folder first, where an older global install can sit. */
export function codexProgram(env: NodeJS.ProcessEnv = process.env): string {
  return env.WIREAL_CODEX_PATH?.trim() || resolveProgram("codex") || "codex";
}

function askCodex(argument: string): string {
  const program = codexProgram();
  const script = /\.(cmd|bat)$/i.test(program);
  const read = spawnSync(
    script ? process.env.ComSpec || "cmd.exe" : program,
    script ? ["/d", "/s", "/c", `"${program}" ${argument}`] : [argument],
    { encoding: "utf8", timeout: 15_000, windowsHide: true },
  );
  return `${read.stdout ?? ""}${read.stderr ?? ""}`;
}

let helpText: string | undefined;
/** What the installed Codex says it takes, read once per runner. */
export function codexHelp(): string {
  helpText ??= askCodex("--help");
  return helpText;
}

let named = false;
/** Which Codex runs, said once, so a stale one on PATH is plain to see. */
function nameCodex(onLine: (text: string) => void) {
  if (named) return;
  named = true;
  const version = /\d+\.\d+\.\d+/.exec(askCodex("--version"))?.[0];
  onLine(
    `Codex ${version ?? "of unknown version"} at ${codexProgram()} (WIREAL_CODEX_PATH picks another)`,
  );
}

/** How a Codex agent gets its approvals without a person there. Not
 *  --ask-for-approval never: a tool the MCP server marks as writing needs
 *  approval, and never is answered by refusing it, so the agent could read
 *  the board and never write a word back to it. --approve-for-me (Codex
 *  0.147 and later) routes the request through Codex's own review and brings
 *  the workspace-write sandbox with it; an older Codex rejects it outright,
 *  so it gets --full-auto, the flag it had for the same purpose. */
export function codexApproval(help: string): string[] {
  if (help.includes("--approve-for-me")) return ["--approve-for-me"];
  if (help.includes("--full-auto")) return ["--full-auto"];
  return [];
}

/** The sandbox a Codex agent runs in. On native Windows Codex's
 *  workspace-write sandbox refuses writes inside the very folder it was
 *  given (openai/codex#34958), so an agent there could never edit a file;
 *  it runs unsandboxed instead, in its own worktree, still under Codex's
 *  approval review. WIREAL_CODEX_SANDBOX names another mode. */
export function codexSandbox(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  // Set through config rather than --sandbox, which Codex refuses beside
  // --approve-for-me.
  const wanted = env.WIREAL_CODEX_SANDBOX?.trim();
  const mode = wanted || (platform === "win32" ? "danger-full-access" : "");
  return mode ? ["-c", `sandbox_mode=${JSON.stringify(mode)}`] : [];
}

export function codexArgs(
  options: AgentOptions,
  approval: string[] = codexApproval(codexHelp()),
  sandbox: string[] = codexSandbox(),
): string[] {
  const proxy = options.mcp;
  const json = (value: unknown) => JSON.stringify(value);
  return [
    "-C",
    options.cwd,
    ...approval,
    ...sandbox,
    // The worktree's index and HEAD live in the parent's .git, and so do the
    // objects and the branch ref a commit writes. Without this the sandbox
    // ends at the worktree and git cannot even take its lock.
    // Unsandboxed, every folder is writable already and Codex only warns
    // that it ignores the extra root.
    ...(options.repo &&
    !sandbox.some((part) => part.includes("danger-full-access"))
      ? ["--add-dir", join(options.repo, ".git")]
      : []),
    "-c",
    `mcp_servers.${proxy.name}.command=${json(proxy.command)}`,
    "-c",
    `mcp_servers.${proxy.name}.args=${json(proxy.args)}`,
    "-c",
    `mcp_servers.${proxy.name}.env.WIREAL_AGENT_NAME=${json(options.agentName)}`,
    "-c",
    `mcp_servers.${proxy.name}.env.WIREAL_API_URL=${json(apiUrl())}`,
    "-c",
    `mcp_servers.${proxy.name}.env.WIREAL_MCP_PROFILE="runner"`,
    ...(options.model ? ["--model", options.model] : []),
    options.prompt,
  ];
}

export function speech(chunk: string): string[] {
  const lines: string[] = [];
  for (const line of plain(chunk).split("\n")) {
    const text = line.replace(/[─-╿▀-▟]+/g, " ").trim();
    if (text.length < 4) continue;
    if (/^[\s•>\-_=.·]+$/.test(text)) continue;
    if (chrome.test(text)) continue;
    lines.push(short(text, 120));
  }
  return lines;
}

export function body(lines: string[]): string[] {
  for (let index = lines.length - 1; index >= 0; index--)
    if (divider.test(plain(lines[index]))) return lines.slice(0, index);
  return lines;
}

export const answerAfter = 2500;

export type CodexParts = {
  open: () => PtySession;
  screen: () => Screen;
  quiet: number;
  grace: number;
  tick: number;
  answer: number;
  rollout: (cwd: string, since: number) => Rollout | undefined;
};

export function rolloutFor(cwd: string, since: number): Rollout | undefined {
  const path = findRollout(sessionsDirectory(), cwd, since);
  return path ? openRollout(path) : undefined;
}

export function startCodex(
  options: AgentOptions,
  parts: Partial<CodexParts> = {},
): AgentRun {
  const startedAt = Date.now();
  const quiet = parts.quiet ?? quietMilliseconds;
  const grace = parts.grace ?? 10_000;
  const tick = parts.tick ?? 1000;
  const answer = parts.answer ?? answerAfter;
  const later = (write: () => void) => {
    if (answer <= 0) return write();
    setTimeout(write, answer).unref?.();
  };
  if (!parts.open) nameCodex(options.onLine);
  const approval = parts.open
    ? ["--approve-for-me"]
    : codexApproval(codexHelp());
  if (!approval.includes("--approve-for-me"))
    options.onLine(
      "this Codex is older than 0.147, so board writes may wait for approval: npm install -g @openai/codex@latest",
    );
  const session =
    parts.open?.() ??
    startPty({
      command: codexProgram(),
      args: codexArgs(options, approval),
      cwd: options.cwd,
      eventsPath: "",
      agentName: options.agentName,
      columns: defaultColumns,
      rows: defaultRows,
    });
  const screen = parts.screen?.() ?? createScreen(defaultColumns, defaultRows);

  let lastData = Date.now();
  let lastLine = "";
  let report = "";
  let exiting = false;
  let trust: "unseen" | "answered" | "refused" = "unseen";
  let refusal = "";
  let recent = "";
  let killer: NodeJS.Timeout | undefined;
  let reading: Promise<void> = Promise.resolve();
  let rollout: Rollout | undefined;
  let rateLimits: RateLimits | undefined;

  const findLimits = parts.rollout ?? rolloutFor;
  const capturedAt = (limits?: RateLimits) => String(limits?.captured_at ?? "");
  const measure = () => {
    rollout ??= findLimits(options.cwd, startedAt);
    const limits = rollout?.limits();
    if (!limits || capturedAt(limits) === capturedAt(rateLimits)) return;
    rateLimits = limits;
    options.onStatus?.({ rateLimits: limits });
  };

  const say = (text: string) => {
    if (text === lastLine) return;
    lastLine = text;
    options.onLine(text);
  };

  const read = (whole: boolean) => {
    reading = reading
      .then(async () => {
        await screen.settled();
        const size = screen.size();
        const taken = screen.scrolled(size.columns);
        if (whole) taken.push(...body(screen.lines(size.rows, size.columns)));
        for (const line of speech(taken.join("\n"))) say(line);
      })
      .catch(() => {});
    return reading;
  };

  const dropData = session.onData((chunk) => {
    lastData = Date.now();
    screen.write(chunk);
    recent = (recent + chunk).slice(-8000);
    if (trust === "unseen" && squeezed(recent).includes(trustQuestion)) {
      recent = "";
      if (options.trustWorktree !== true) {
        trust = "refused";
        refusal = `Codex does not trust ${options.cwd}. The runner answers its directory question unless it was started with --ask-trust.`;
        options.onLine("the directory is not trusted");
        session.kill();
        return;
      }
      trust = "answered";
      options.onLine("accepted the codex directory question");
      later(() => session.write(trustAnswer));
    }
    read(false);
  });

  const timer = setInterval(() => {
    measure();
    if (exiting || Date.now() - lastData < quiet) return;
    exiting = true;
    read(true).then(() => {
      report = lastLine;
      options.onLine("quiet for 20s, leaving the session");
      session.write(exitCommand);
      later(() => session.write(enter));
      killer = setTimeout(() => session.kill(), grace);
      killer.unref?.();
    });
  }, tick);
  timer.unref?.();

  const done = new Promise<AgentResult>((resolve) => {
    session.onExit((code) => {
      clearInterval(timer);
      if (killer) clearTimeout(killer);
      dropData();
      const settle = () => {
        measure();
        resolve({
          ok: code === 0 && trust !== "refused",
          summary:
            report || lastLine ? short(report || lastLine, 480) : undefined,
          // An exit code says little on its own (a session closed after
          // going quiet ends the same way whatever stopped it), so the last
          // thing Codex showed rides along: a question it was waiting on, a
          // model it refused, a limit it hit.
          error:
            refusal ||
            (code === 0
              ? undefined
              : `Codex exited with code ${code}.${lastLine ? ` Last on its screen: ${short(lastLine, 200)}` : ""}`),
          ...(rateLimits ? { rateLimits } : {}),
        });
      };
      if (report || trust === "refused") settle();
      else read(true).then(settle);
    });
  });

  const pty: PtyLink = {
    write: (data) => session.write(data),
    resize: (columns, rows) => {
      session.resize(columns, rows);
      screen.resize(columns, rows);
    },
    onData: (listen) => session.onData(listen),
  };

  return { done, stop: () => session.kill(), pty, screen };
}

export const codex: AgentDriver = {
  kind: "codex",
  command: "codex",
  start: (options) => startCodex(options),
};
