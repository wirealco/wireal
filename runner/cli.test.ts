import assert from "node:assert/strict";
import test from "node:test";
import { crewOf, parseCommand, runnerVersion, usage } from "./cli.ts";

test("the version is asked for by name or flag, and read beside the bundle", () => {
  assert.deepEqual(parseCommand(["version"]), { kind: "version" });
  assert.deepEqual(parseCommand(["--version"]), { kind: "version" });
  assert.deepEqual(parseCommand(["-v"]), { kind: "version" });
  assert.match(runnerVersion(), /^\d+\.\d+\.\d+$/);
});

test("rename takes its name from the words after it, or from --name", () => {
  assert.deepEqual(parseCommand(["rename", "Usage", "limits"], "/repo"), {
    kind: "rename",
    repo: "/repo",
    name: "Usage limits",
  });
  assert.deepEqual(parseCommand(["rename", "--name", "Studio"], "/repo"), {
    kind: "rename",
    repo: "/repo",
    name: "Studio",
  });
  assert.deepEqual(parseCommand(["rename", "--repo", "/other"], "/repo"), {
    kind: "rename",
    repo: "/other",
  });
});

test("run carries the force flag that takes a held folder", () => {
  const started = parseCommand(["run", "--force"], "/repo");
  assert.equal(started.kind === "run" && started.force, true);
  const plain = parseCommand(["run"], "/repo");
  assert.equal(plain.kind === "run" && plain.force, false);
});

test("usage stands on its own and the help names the new commands", () => {
  assert.deepEqual(parseCommand(["usage"], "/repo"), { kind: "usage" });
  assert.match(usage, /wireal-run rename \[name\]/);
  assert.match(usage, /wireal-run usage /);
  assert.match(usage, /--force/);
});

test("checks shows, sets and clears, and never mixes the two", () => {
  assert.deepEqual(parseCommand(["checks"], "/repo"), {
    kind: "checks",
    repo: "/repo",
    clear: false,
  });
  assert.deepEqual(
    parseCommand(["checks", "npm test", "npm run build"], "/repo"),
    {
      kind: "checks",
      repo: "/repo",
      clear: false,
      commands: ["npm test", "npm run build"],
    },
  );
  assert.deepEqual(parseCommand(["checks", "--clear"], "/repo"), {
    kind: "checks",
    repo: "/repo",
    clear: true,
  });
  assert.throws(
    () => parseCommand(["checks", "--clear", "npm test"], "/repo"),
    /--clear takes no commands/,
  );
  assert.match(usage, /wireal-run checks \[command\.\.\.\]/);
});

test("run takes how many agents to bring from flags, then the environment", () => {
  const crew = (argv: string[], env: NodeJS.ProcessEnv = {}) => {
    const parsed = parseCommand(["run", ...argv], "/repo", env);
    return parsed.kind === "run" ? parsed.crew : undefined;
  };
  assert.deepEqual(crew([]), {});
  assert.deepEqual(crew(["--agents", "3"]), { each: 3 });
  assert.deepEqual(crew(["--claude", "2", "--codex", "1"]), {
    claude: 2,
    codex: 1,
  });
  assert.deepEqual(crew([], { WIREAL_AGENTS: "2", WIREAL_CODEX: "0" }), {
    each: 2,
    codex: 0,
  });
  assert.deepEqual(crew(["--agents", "1"], { WIREAL_AGENTS: "4" }), {
    each: 1,
  });
  assert.deepEqual(crewOf({}, { WIREAL_CLAUDE: " " }), {});
  assert.throws(() => crew(["--claude", "9"]), /from 0 to 8/);
  assert.throws(() => crew([], { WIREAL_CODEX: "many" }), /--codex/);
  assert.match(usage, /--agents <n>/);
  assert.match(usage, /--claude <n>/);
  assert.match(usage, /--codex <n>/);
});
