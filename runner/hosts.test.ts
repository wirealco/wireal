import assert from "node:assert/strict";
import test from "node:test";
import { launch } from "./agents/pty.ts";
import { detectHosts, extensions, resolveProgram } from "./hosts.ts";

const found = (...files: string[]) => {
  const there = new Set(files);
  return (file: string) => there.has(file);
};

test("a CLI is found on the path, with the extension Windows expects", () => {
  const unix = {
    platform: "linux" as const,
    path: "/usr/bin:/home/ada/.local/bin",
    exists: found("/home/ada/.local/bin/claude"),
  };
  assert.equal(resolveProgram("claude", unix), "/home/ada/.local/bin/claude");
  assert.equal(resolveProgram("codex", unix), "");
  assert.deepEqual(detectHosts(unix), ["claude"]);

  const windows = {
    platform: "win32" as const,
    path: "C:\\bin;C:\\npm",
    pathExt: ".COM;.EXE;.BAT;.CMD",
    exists: found("C:\\bin\\claude.exe", "C:\\npm\\codex.cmd"),
  };
  assert.equal(resolveProgram("claude", windows), "C:\\bin\\claude.exe");
  assert.equal(resolveProgram("codex", windows), "C:\\npm\\codex.cmd");
  assert.deepEqual(detectHosts(windows), ["claude", "codex"]);
});

test("PATHEXT decides the extensions, and a bare name still counts", () => {
  assert.deepEqual(extensions("darwin"), [""]);
  assert.deepEqual(extensions("win32", ".EXE;.CMD"), [".exe", ".cmd", ""]);
  assert.deepEqual(extensions("win32", ""), [
    ".com",
    ".exe",
    ".bat",
    ".cmd",
    "",
  ]);
  assert.equal(
    resolveProgram("claude", {
      platform: "win32",
      path: "C:\\bin",
      pathExt: ".EXE",
      exists: found("C:\\bin\\claude"),
    }),
    "C:\\bin\\claude",
  );
});

test("a Windows shim is started through the shell, an exe on its own", () => {
  assert.deepEqual(launch("claude", ["--once"], "darwin"), {
    file: "claude",
    args: ["--once"],
  });
  assert.deepEqual(
    launch("codex", ["run"], "win32", () => "C:\\npm\\codex.cmd", "cmd.exe"),
    { file: "cmd.exe", args: ["/d", "/s", "/c", "C:\\npm\\codex.cmd", "run"] },
  );
  assert.deepEqual(
    launch("claude", ["run"], "win32", () => "C:\\bin\\claude.exe", "cmd.exe"),
    { file: "C:\\bin\\claude.exe", args: ["run"] },
  );
  assert.deepEqual(
    launch("claude", ["run"], "win32", () => "", "cmd.exe"),
    { file: "cmd.exe", args: ["/d", "/s", "/c", "claude.cmd", "run"] },
  );
});
