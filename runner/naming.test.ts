import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanName,
  pathLike,
  programs,
  nameLimit,
  orcaName,
  screenName,
  terminalName,
  tmuxName,
  windowsName,
} from "./naming.ts";

const answers = (given: Record<string, string>) => {
  const asked: string[] = [];
  const run = (command: string, args: string[]) => {
    asked.push([command, ...args].join(" "));
    const said = given[command];
    if (said === undefined) throw new Error(`no ${command} here`);
    return said;
  };
  return { run, asked };
};

test("a tmux window lends its name, and only when tmux is there", () => {
  const { run, asked } = answers({ tmux: "usage limits\n" });
  assert.equal(
    tmuxName({
      env: { TMUX: "/tmp/tmux-501/default,1,0" },
      run,
      platform: "darwin",
    }),
    "usage limits",
  );
  assert.deepEqual(asked, ["tmux display-message -p #W"]);
  assert.equal(tmuxName({ env: {}, run }), "");
  assert.equal(tmuxName({ env: { TMUX: " " }, run }), "");
});

test("a screen session lends its name without its pid", () => {
  assert.equal(screenName({ env: { STY: "48213.runner" } }), "runner");
  assert.equal(screenName({ env: {} }), "");
});

test("an Orca tab lends its title, glyph and all stripped", () => {
  const said = JSON.stringify({
    ok: true,
    result: { terminal: { title: "◑ Orca usage limits for runner" } },
  });
  const { run, asked } = answers({ orca: said });
  assert.equal(
    orcaName({
      env: { ORCA_TERMINAL_HANDLE: "term_1" },
      run,
      platform: "darwin",
    }),
    "Orca usage limits for runner",
  );
  assert.deepEqual(asked, ["orca terminal show --terminal term_1 --json"]);
  assert.equal(orcaName({ env: {}, run }), "");
  assert.equal(
    orcaName({
      env: { ORCA_TERMINAL_HANDLE: "term_1" },
      run: () => "not json",
    }),
    "",
  );
});

test("a title that only names the program we are is no name at all", () => {
  assert.equal(cleanName("wireal-run run"), "");
  assert.equal(cleanName("npx wireal-run"), "");
  assert.equal(cleanName("zsh"), "");
  assert.equal(cleanName("claude"), "");
  assert.equal(cleanName("   "), "");
  assert.equal(cleanName("\u001b[32mgreen tab\u001b[0m"), "green tab");
  assert.equal(cleanName("a".repeat(nameLimit + 20)).length, nameLimit);
});

test("on Windows the shim is tried before the bare command", () => {
  assert.deepEqual(programs("orca", "win32"), ["orca.cmd", "orca.exe", "orca"]);
  assert.deepEqual(programs("orca", "darwin"), ["orca"]);
  const tried: string[] = [];
  const name = orcaName({
    env: { ORCA_TERMINAL_HANDLE: "term_1" },
    platform: "win32",
    run: (command) => {
      tried.push(command);
      if (command !== "orca.exe") throw new Error("not this one");
      return JSON.stringify({ result: { terminal: { title: "Windows tab" } } });
    },
  });
  assert.deepEqual(tried, ["orca.cmd", "orca.exe"]);
  assert.equal(name, "Windows tab");
});

test("the first terminal that answers is the one that names the runner", () => {
  const { run } = answers({
    tmux: "tmux tab",
    orca: JSON.stringify({ result: { terminal: { title: "orca tab" } } }),
  });
  assert.equal(
    terminalName({
      env: { TMUX: "/tmp/one", ORCA_TERMINAL_HANDLE: "term_1" },
      run,
    }),
    "tmux tab",
  );
  assert.equal(
    terminalName({ env: { ORCA_TERMINAL_HANDLE: "term_1" }, run }),
    "orca tab",
  );
  assert.equal(terminalName({ env: {}, run }), "");
});

test("a Windows console lends the title it is showing", () => {
  const { run, asked } = answers({ powershell: "Runner tab\r\n" });
  assert.equal(windowsName({ env: {}, platform: "win32", run }), "Runner tab");
  assert.deepEqual(asked, [
    "powershell.cmd -NoProfile -NonInteractive -Command [Console]::Title",
    "powershell.exe -NoProfile -NonInteractive -Command [Console]::Title",
    "powershell -NoProfile -NonInteractive -Command [Console]::Title",
  ]);
  assert.equal(
    windowsName({ env: { ConEmuTask: "Build tab" }, platform: "win32", run }),
    "Build tab",
  );
  assert.equal(windowsName({ env: {}, platform: "darwin", run }), "");
});

test("the titles Windows gives a bare console are not names", () => {
  for (const title of [
    "Command Prompt",
    "Windows PowerShell",
    "Administrator: Windows PowerShell",
    "C:\\Windows\\System32\\cmd.exe",
    "cmd.exe",
    "Select C:\\Windows\\System32\\cmd.exe",
    "\\\\wsl.localhost\\Ubuntu",
  ])
    assert.equal(cleanName(title), "", `${title} should not name a runner`);
  assert.equal(pathLike("C:/repo/wireal"), true);
  assert.equal(pathLike("Runner tab"), false);
});
