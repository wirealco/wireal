#!/usr/bin/env -S npx tsx
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { login } from "./login.ts";
import { run } from "./loop.ts";
import {
  bindingChecks,
  renameBinding,
  resolveBinding,
  setBindingChecks,
} from "./binding.ts";
import { terminalName } from "./naming.ts";
import { openSession, runnerRows } from "./api.ts";
import {
  clearBinding,
  clearSession,
  readBinding,
  readSession,
  sessionPath,
  shortHostname,
} from "./session.ts";
import { hostKinds } from "./hosts.ts";
import { crewLimit, type Crew } from "./crew.ts";
import { readUsage, usageLine } from "./agents/usage.ts";
import { elsewhereMessage, holdRunner, liveElsewhere } from "./single.ts";

export const usage = `Wireal runner

Usage
  wireal-run login                 Sign in to Wireal on this machine
  wireal-run run [options]         Claim ready tasks and run an agent on each
  wireal-run usage                 Show what is left of each agent's limits
  wireal-run checks [command...]   Show, set or clear this folder's merge checks
  wireal-run rename [name]         Rename this folder's runner
  wireal-run status                Show this folder's runner binding
  wireal-run unbind                Remove this folder's runner binding
  wireal-run logout                Forget the saved session
  wireal-run version               Print the runner's version

Run options
  --workspace <name|id>            Bind this folder to a workspace
  --name <text>                    Name this runner and save the name
  --agents <n>                     Replace the saved crew with n agents per CLI found
  --claude <n>                     Claude Code agents in that crew, over --agents
  --codex <n>                      Codex agents in that crew, over --agents
  --repo <path>                    Repository to make worktrees in (default: this folder)
  --once                           Take one round of tasks, then stop
  --force                          Start even when another runner holds this folder
  --allow-sleep                    Let the machine sleep while the runner waits
  --ask-trust                      Leave the agents' folder trust question to you
                                   (answered by default: the worktree is your repository's)

Checks options
  --clear                          Run no checks in this folder

While it runs
  +                                Add an agent on the CLI the crew uses least
  c / x                            Add a Claude Code / a Codex agent
  -                                Remove the highest-numbered idle agent
  p                                Pause or resume taking new tasks here
  1-9                              Attach to an agent (ctrl-g detaches)
  q                                Stop

Agents are the runner's: it starts with one per CLI it finds on its PATH,
numbered after itself ("Studio 1", "Studio 2") whatever CLI each runs, and
seats them on itself. The crew the keys make is saved for this folder, so a
restart brings the same agents. WIREAL_AGENTS, WIREAL_CLAUDE and WIREAL_CODEX
set the same counts as the flags. Checks belong to this machine, never to the
workspace, so nobody else can name a command that runs here. WIREAL_API_URL
points the runner at another Wireal API.`;

/* The packed bundle sits at <package>/bin/wireal-run.mjs and the source at
   <repo>/runner/cli.ts, so one relative path finds the manifest either way,
   the same as the hooks beside the bundle. */
export function runnerVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "login" }
  | { kind: "logout" }
  | { kind: "usage" }
  | { kind: "rename"; repo: string; name?: string }
  | { kind: "checks"; repo: string; commands?: string[]; clear: boolean }
  | { kind: "status"; repo: string }
  | { kind: "unbind"; repo: string }
  | {
      kind: "run";
      workspace?: string;
      name?: string;
      crew: Crew;
      repo: string;
      once: boolean;
      force: boolean;
      allowSleep: boolean;
      trustWorktree: boolean;
    };

function count(
  flag: string,
  value: string | undefined,
  env: string | undefined,
): number | undefined {
  const given = value ?? (env?.trim() ? env : undefined);
  if (given === undefined) return undefined;
  const amount = Number(given);
  if (!Number.isInteger(amount) || amount < 0 || amount > crewLimit)
    throw new Error(
      `${flag} takes a whole number of agents from 0 to ${crewLimit}.`,
    );
  return amount;
}

/** How many agents to run: flags first, then WIREAL_AGENTS, WIREAL_CLAUDE and
 *  WIREAL_CODEX. Unset counts stay out, so the runner's default of one per CLI
 *  applies. */
export function crewOf(
  values: { agents?: string; claude?: string; codex?: string },
  env: NodeJS.ProcessEnv = process.env,
): Crew {
  const each = count("--agents", values.agents, env.WIREAL_AGENTS);
  const claude = count("--claude", values.claude, env.WIREAL_CLAUDE);
  const codex = count("--codex", values.codex, env.WIREAL_CODEX);
  return {
    ...(each === undefined ? {} : { each }),
    ...(claude === undefined ? {} : { claude }),
    ...(codex === undefined ? {} : { codex }),
  };
}

export function parseCommand(
  argv: string[],
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Command {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      workspace: { type: "string" },
      name: { type: "string" },
      agents: { type: "string" },
      claude: { type: "string" },
      codex: { type: "string" },
      repo: { type: "string" },
      once: { type: "boolean" },
      force: { type: "boolean" },
      "allow-sleep": { type: "boolean" },
      "trust-worktree": { type: "boolean" },
      "ask-trust": { type: "boolean" },
      clear: { type: "boolean" },
    },
  });
  const name = positionals[0] ?? "";
  if (values.version || name === "version") return { kind: "version" };
  if (values.help || !name || name === "help") return { kind: "help" };
  if (name === "login" || name === "logout" || name === "usage")
    return { kind: name };
  if (name === "status" || name === "unbind")
    return { kind: name, repo: values.repo ?? cwd };
  if (name === "checks") {
    const commands = positionals.slice(1).map((entry) => entry.trim());
    if (values.clear && commands.length)
      throw new Error("--clear takes no commands.");
    return {
      kind: "checks",
      repo: values.repo ?? cwd,
      clear: values.clear === true,
      ...(commands.length ? { commands } : {}),
    };
  }
  if (name === "rename") {
    const wanted = (positionals.slice(1).join(" ") || values.name || "").trim();
    return {
      kind: "rename",
      repo: values.repo ?? cwd,
      ...(wanted ? { name: wanted } : {}),
    };
  }
  if (name !== "run") throw new Error(`Unknown command: ${name}`);
  if (values.name !== undefined && !values.name.trim())
    throw new Error("--name takes a non-empty runner name.");
  return {
    kind: "run",
    workspace: values.workspace,
    name: values.name,
    crew: crewOf(values, env),
    repo: values.repo ?? cwd,
    once: values.once === true,
    force: values.force === true,
    allowSleep: values["allow-sleep"] === true,
    // The worktree is a checkout of the repository this runner was started
    // in, so the agents' CLIs are told to trust it unless asked not to.
    // --trust-worktree, which used to turn this on, is still accepted.
    trustWorktree: values["ask-trust"] !== true,
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let command: Command;
  try {
    command = parseCommand(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${usage}`);
    return 2;
  }
  if (command.kind === "help") {
    console.log(usage);
    return 0;
  }
  if (command.kind === "version") {
    console.log(runnerVersion());
    return 0;
  }
  try {
    if (command.kind === "login") {
      const session = await login();
      console.log(`Signed in to ${session.apiUrl} as this machine.`);
      return 0;
    }
    if (command.kind === "logout") {
      const path = sessionPath();
      console.log(
        clearSession(path) ? `Removed ${path}` : "No saved session to remove.",
      );
      return 0;
    }
    if (command.kind === "usage") {
      const now = Date.now();
      for (const kind of hostKinds)
        console.log(usageLine(kind, await readUsage(kind), now));
      return 0;
    }
    if (command.kind === "checks") {
      if (!command.commands && !command.clear) {
        const saved = bindingChecks(command.repo);
        if (!saved) {
          console.log("No binding for this folder.");
          return 1;
        }
        if (!saved.length) {
          console.log(
            'No checks in this folder. Set them: wireal-run checks "npm test"',
          );
          return 0;
        }
        for (const entry of saved) console.log(entry);
        return 0;
      }
      const written = setBindingChecks(command.repo, command.commands ?? []);
      if (!written) {
        console.log("No binding for this folder.");
        return 1;
      }
      console.log(
        written.length
          ? `A branch merges here once these pass:\n${written.map((entry) => `  ${entry}`).join("\n")}`
          : "This folder runs no checks before a merge.",
      );
      return 0;
    }
    if (command.kind === "rename") {
      const wanted = command.name || terminalName();
      if (!wanted) {
        console.error(
          "This terminal has no name to take. Pass one: wireal-run rename <name>",
        );
        return 2;
      }
      const renamed = renameBinding(command.repo, wanted);
      if (!renamed) {
        console.log("No binding for this folder.");
        return 1;
      }
      console.log(
        renamed.from === renamed.to
          ? `This runner is already called ${renamed.to}.`
          : `Renamed ${renamed.from} to ${renamed.to}. A runner already running takes it on its next heartbeat.`,
      );
      return 0;
    }
    if (command.kind === "status") {
      const binding = readBinding(command.repo);
      if (!binding) {
        console.log("No binding for this folder.");
        return 1;
      }
      console.log(`Workspace: ${binding.workspaceId}`);
      console.log(`Name: ${binding.name}`);
      console.log(`ID: ${binding.id}`);
      return 0;
    }
    if (command.kind === "unbind") {
      console.log(
        clearBinding(command.repo)
          ? "Unbound this folder."
          : "No binding for this folder.",
      );
      return 0;
    }
    if (!readSession()) {
      console.error("Not signed in. Run `wireal-run login` first.");
      return 1;
    }
    const session = openSession();
    const binding = await resolveBinding({
      repoPath: command.repo,
      workspace: command.workspace,
      name: command.name,
      client: {
        workspaces: () => session.client("Wireal runner").listWorkspaces(),
        workspace: async (workspaceId) =>
          (await session.client("Wireal runner", workspaceId).read()).workspace,
      },
    });
    const release = holdRunner(
      { id: binding.id, name: binding.name, repo: binding.repoPath },
      { force: command.force },
    );
    try {
      if (!command.force) {
        const rows = await runnerRows(session.data)(binding.workspaceId).catch(
          () => [],
        );
        const elsewhere = liveElsewhere(rows, binding.id, shortHostname());
        if (elsewhere) {
          console.error(elsewhereMessage(elsewhere.row, elsewhere.seconds));
          return 1;
        }
      }
      await run({
        workspace: binding.workspaceId,
        crew: command.crew,
        repo: binding.repoPath,
        checks: binding.checks ?? [],
        once: command.once,
        allowSleep: command.allowSleep,
        trustWorktree: command.trustWorktree,
        identity: binding,
      });
    } finally {
      release();
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
  // A finished command ends the process itself: an agent's terminal, the
  // keyboard and the odd timer can each keep Node waiting after the runner
  // has already left the board, and the window would sit on "stopping
  // agents". The short wait lets anything still being written get out.
  setTimeout(() => process.exit(), 300).unref();
  process.stdin.pause();
}
