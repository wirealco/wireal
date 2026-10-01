const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

/* The runner keeps .wireal/notice.json in the worktree: the few facts about
   other agents and people that concern this agent right now. This hook hands
   Claude only the facts it has not been handed before, and says nothing at
   all otherwise, so staying in step costs no tokens while nothing changes. */

function lines(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(parsed) ? parsed : parsed && parsed.lines;
    return Array.isArray(list)
      ? list.filter((line) => typeof line === "string" && line.trim())
      : [];
  } catch {
    return [];
  }
}

function fresh(worktree) {
  if (!worktree) return [];
  const folder = join(worktree, ".wireal");
  const seenPath = join(folder, "seen.json");
  const current = lines(join(folder, "notice.json")).slice(0, 3);
  const seen = new Set(lines(seenPath));
  const unseen = current.filter((line) => !seen.has(line));
  if (!unseen.length) return [];
  try {
    writeFileSync(seenPath, JSON.stringify([...seen, ...unseen].slice(-50)));
  } catch {
    return [];
  }
  return unseen;
}

function answer(event, unseen) {
  if (!unseen.length) return "";
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: unseen.join("\n"),
    },
  });
}

module.exports = { fresh, answer };

if (require.main === module) {
  const { read, write } = require("./record.cjs");
  read((payload) => {
    const event =
      process.argv[2] ||
      (typeof payload.hook_event_name === "string"
        ? payload.hook_event_name
        : "PostToolUse");
    write(event, payload);
    const said = answer(event, fresh(process.env.WIREAL_AGENT_WORKTREE));
    if (said) process.stdout.write(said);
  });
}
