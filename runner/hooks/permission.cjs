const { homedir } = require("node:os");
const { isAbsolute, resolve, sep } = require("node:path");

const pathKeys = new Set([
  "file_path",
  "path",
  "notebook_path",
  "directory",
  "cwd",
  "target_file",
  "output_path",
]);

function expanded(value, home = homedir()) {
  if (value === "~") return home;
  return value.startsWith("~/") ? resolve(home, value.slice(2)) : value;
}

// Places every command may name without leaving its worktree in any sense
// that matters: the null device and the terminal's streams.
const harmless = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/stdin",
  "/dev/tty",
]);

// Claude Code's Bash tool on Windows runs Git Bash, whose paths name a drive
// as /c/Users/...; resolved as they stand they would land in C:\c\Users.
function native(value, platform = process.platform) {
  if (platform !== "win32") return value;
  const drive = /^\/([a-zA-Z])(?=\/|$)/.exec(value);
  return drive ? `${drive[1]}:\\${value.slice(3)}` : value;
}

function within(root, full, platform = process.platform) {
  // Windows paths ignore case, and a tool may spell the drive either way.
  const [a, b] =
    platform === "win32"
      ? [root.toLowerCase(), full.toLowerCase()]
      : [root, full];
  return b === a || b.startsWith(a + sep);
}

function inside(worktree, value, platform = process.platform) {
  if (harmless.has(value)) return true;
  const root = resolve(worktree);
  const wanted = native(expanded(value), platform);
  const full = isAbsolute(wanted) ? resolve(wanted) : resolve(root, wanted);
  return within(root, full, platform);
}

function named(input, found) {
  if (Array.isArray(input)) {
    for (const item of input) named(item, found);
    return found;
  }
  if (!input || typeof input !== "object") return found;
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      if (pathKeys.has(key)) found.push(value);
      if (key === "command")
        for (const path of absolutes(value)) found.push(path);
      continue;
    }
    named(value, found);
  }
  return found;
}

const token =
  /(?:^|[\s'"=(])(~(?:\/[^\s'";|&)]*)?|\.\.(?:\/[^\s'";|&)]*)?|\/[^\s'";|&)]*)(?=$|[\s'";|&)])/g;

function absolutes(command) {
  const found = [];
  for (const match of command.matchAll(token)) {
    const value = match[1];
    if (value && value !== "/") found.push(value);
  }
  return found;
}

function decide(payload, worktree) {
  if (!worktree) return { allow: true, reason: "no worktree configured" };
  const paths = named(payload && payload.tool_input, []);
  const outside = paths.filter((value) => !inside(worktree, value));
  if (outside.length === 0)
    return {
      allow: true,
      reason: paths.length
        ? `paths stay inside ${worktree}`
        : "the tool names no path",
    };
  return {
    allow: false,
    reason: `outside the worktree: ${outside.join(", ")}`,
  };
}

function answer(event, verdict) {
  if (event === "PreToolUse")
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: verdict.allow ? "allow" : "deny",
        permissionDecisionReason: verdict.reason,
      },
    };
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: verdict.allow
        ? { behavior: "allow" }
        : { behavior: "deny", message: verdict.reason },
    },
  };
}

module.exports = { decide, answer, inside, named };

if (require.main === module) {
  const { read, write } = require("./record.cjs");
  read((payload) => {
    const event =
      typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : "PermissionRequest";
    write(event, payload);
    process.stdout.write(
      JSON.stringify(
        answer(event, decide(payload, process.env.WIREAL_AGENT_WORKTREE)),
      ),
    );
  });
}
