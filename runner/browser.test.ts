import assert from "node:assert/strict";
import test from "node:test";
import { browserCli, readyBrowser } from "./browser.ts";

test("installs the pinned chromium once so no agent downloads its own", async () => {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const report = await readyBrowser("/repo", {
    exists: () => true,
    node: "/usr/bin/node",
    run: async (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return { code: 0, output: "chromium 141.0 is already downloaded\n" };
    },
  });
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/node",
      args: [browserCli("/repo"), "install", "chromium"],
      cwd: "/repo",
    },
  ]);
  assert.equal(report.ready, true);
  assert.equal(report.downloaded, false);
});

test("says when the build had to come down the wire", async () => {
  const report = await readyBrowser("/repo", {
    exists: () => true,
    run: async () => ({
      code: 0,
      output: "Chromium 141.0 downloaded to /cache/chromium-1208\n",
    }),
  });
  assert.equal(report.ready, true);
  assert.equal(report.downloaded, true);
});

test("reports a repository that never installed playwright-core", async () => {
  let ran = false;
  const report = await readyBrowser("/repo", {
    exists: () => false,
    run: async () => {
      ran = true;
      return { code: 0, output: "" };
    },
  });
  assert.equal(ran, false);
  assert.equal(report.ready, false);
  assert.match(report.reason, /playwright-core is not installed/);
});

test("carries the last line of a failed install as the reason", async () => {
  const report = await readyBrowser("/repo", {
    exists: () => true,
    run: async () => ({
      code: 1,
      output: "Downloading Chromium\nError: getaddrinfo ENOTFOUND cdn\n",
    }),
  });
  assert.equal(report.ready, false);
  assert.equal(report.downloaded, false);
  assert.match(report.reason, /ENOTFOUND/);
});
