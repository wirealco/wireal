# wireal-run

The Wireal runner. It watches one folder on your machine, claims the tasks your
[Wireal](https://wireal.co) workspace has made ready, and runs Claude Code or
the Codex CLI on each one in its own git worktree.

```sh
npx wireal-run login
npx wireal-run run
```

The first command signs this machine in. The second binds the folder you are in
to a workspace and starts its own agents: one per CLI it finds on your PATH
(`claude`, `codex`), numbered after the runner ("Studio 1", "Studio 2") with
the CLI shown as a tag. Nobody sets agents up in the app. While it runs, `+`
adds an agent (on the CLI used least; `c` or `x` for Claude Code or Codex), `-`
removes the highest-numbered idle one, `p` pauses or resumes taking new tasks,
`1-9` attaches to an agent and `q` stops. The crew is saved for the folder, so
a restart brings the same agents.

| Command                          | What it does                                  |
| -------------------------------- | --------------------------------------------- |
| `wireal-run login`               | Sign in to Wireal on this machine             |
| `wireal-run run`                 | Claim ready tasks and run an agent on each    |
| `wireal-run usage`               | Show what is left of each agent's limits      |
| `wireal-run checks [command...]` | Show, set or clear this folder's merge checks |
| `wireal-run rename [name]`       | Rename this folder's runner                   |
| `wireal-run status`              | Show this folder's runner binding             |
| `wireal-run unbind`              | Remove this folder's runner binding           |
| `wireal-run logout`              | Forget the saved session                      |

Useful flags on `run`: `--workspace <name>` to bind a folder the first time,
`--agents <n>` to replace the saved crew with n agents per CLI (`0` runs
none), `--claude <n>` and `--codex <n>` for one kind, `--repo <path>` to work
on another folder, `--once` to take one round and stop.

The saved sign-in refreshes itself: the runner rotates its token a minute
before it runs out, so a run left going overnight keeps working. Rotation is
one token at a time across every `wireal-run` on the machine, and a refresh
that cannot take the lock waits rather than racing, because the server treats a
token used twice as stolen and revokes the whole sign-in. If that does happen,
`wireal-run login` is the only way back, and the runner says so once and stops
instead of retrying for hours.

One runner to a folder: a second `run` in a folder another runner already
holds names the process holding it and stops rather than claiming the same
tasks twice. A runner that died without cleaning up is taken over on the next
start, as is one whose note predates the last boot, and `--force` takes the
folder from a runner that is still going. It works the same on macOS, Linux
and Windows; folders are matched as Windows compares them there.

On Windows the runner finds `claude` and `codex` through `PATHEXT`, starts an
`npm` shim through the shell that can run it, and takes its name from the
console title or the ConEmu task. Nothing here needs Orca: the Orca tab is
read only when Orca itself started the terminal.

While it runs, `1`–`9` attaches to an agent's screen, `ctrl-g` detaches, and
`q` quits. The machine is kept awake for as long as the runner is up, so an
agent is never cut off by the lid or the idle timer; the cup in the header
steams while that hold is in place, and `--allow-sleep` starts without it. The
tab takes the runner's name while it holds it, and gives the name back when you
quit.

The screen is one framed dashboard: the header says whether the runner is
live, paused or cut off from Wireal; under it each CLI's 5-hour and weekly
limits fill in as bars; then one row per agent with what it is working on, how
long it has been at it, its current step and the files it has written; and at
the bottom a timestamped feed of what the runner did. A narrow terminal drops
the reset times, the files and the less needed columns, and a short one gives
up feed lines first. `NO_COLOR` turns the colours off, and output that is not
a terminal gets plain timestamped lines instead of the screen.

A new binding is named after the terminal it was made in — the tmux window, the
screen session or the Orca tab — and falls back to the folder. `wireal-run
rename <name>` renames it later; `wireal-run rename` with no name takes the
terminal's name again. A runner already running picks the new name up on its
next heartbeat, so the app follows without a restart.

The runner reads each signed-in CLI's own usage limits without starting an
agent: Codex every few minutes, Claude about once an hour, which is as often as
Anthropic gives them out. Between reads it falls back to what is already on
disk — the last figures it read, kept beside its session file, and the ones
Codex writes into its own rollouts — so the 5-hour and 7-day columns are filled
in before you hand out work, here and in the app. An agent whose window is over
the workspace's pause limit is held back rather than claiming a task.

To read them it uses each CLI's own sign-in: Claude Code's OAuth access token
from `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`), or on macOS from
the `Claude Code-credentials` keychain item, and Codex's from
`~/.codex/auth.json` (or `CODEX_HOME`). Each token goes only to its own
provider's usage endpoint (`api.anthropic.com`, `chatgpt.com`); none is stored
or sent to Wireal, which receives only the percentages and reset times.

A branch merges only once this folder's checks pass, and those belong to this
machine rather than to the workspace, so nobody who shares the workspace can
name a command that runs on your computer. `wireal-run checks` prints them,
`wireal-run checks "npm test" "npm run build"` sets them, and `wireal-run
checks --clear` runs none.

The rest is configured in the app, not here: the workspace's mode and merge
policy, and which task is locked to which agent. Full setup at
[wireal.co/docs](https://wireal.co/docs).

On a self-hosted Wireal server, set `WIREAL_API_URL` to its API origin and
`WIREAL_MCP_RESOURCE` to its MCP origin before `wireal-run login`
(`WIREAL_APP_URL` names the web app if it is not the API host without `api.`).

Requires Node 22 or newer, git, and the agent CLIs you want to host.
