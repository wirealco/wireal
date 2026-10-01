import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { awakeCommand, keepAwake, watchEvery } from "./awake.ts";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    kill: () => boolean;
    unref: () => void;
  };
  const killed: number[] = [];
  child.kill = () => {
    killed.push(1);
    child.emit("exit", 0);
    return true;
  };
  child.unref = () => {};
  return { child: child as unknown as ChildProcess, killed };
}

test("each platform is asked to stay awake in its own words", () => {
  const mac = awakeCommand("darwin", 4242);
  assert.equal(mac?.command, "caffeinate");
  assert.deepEqual(mac?.args, ["-i", "-w", "4242"]);

  const windows = awakeCommand("win32", 4242);
  assert.equal(windows?.command, "powershell.exe");
  const said = windows?.args.at(-1) ?? "";
  assert.match(said, /SetThreadExecutionState\(0x80000001\)/);
  assert.match(said, /Get-Process -Id 4242/);
  assert.match(said, new RegExp(`Start-Sleep -Seconds ${watchEvery}`));

  const linux = awakeCommand("linux", 4242);
  assert.equal(linux?.command, "systemd-inhibit");
  assert.ok(linux?.args.includes("--what=idle:sleep"));
  assert.match(linux?.args.at(-1) ?? "", /kill -0 4242/);
});

test("the hold is held until it is released, and released only once", () => {
  const { child, killed } = fakeChild();
  const asked: { command: string; args: string[] }[] = [];
  const awake = keepAwake({
    platform: "darwin",
    pid: 4242,
    start: (command, args) => {
      asked.push({ command, args });
      return child;
    },
  });
  assert.deepEqual(asked, [
    { command: "caffeinate", args: ["-i", "-w", "4242"] },
  ]);
  assert.equal(awake.held(), true);
  assert.equal(awake.why, "caffeinate");
  awake.release();
  assert.equal(awake.held(), false);
  awake.release();
  assert.deepEqual(killed, [1]);
});

test("a machine that will not hold it says so instead of pretending", () => {
  const awake = keepAwake({
    platform: "linux",
    pid: 1,
    start: () => undefined,
  });
  assert.equal(awake.held(), false);
  assert.doesNotThrow(() => awake.release());
});

test("a hold that dies on its own stops being held", () => {
  const { child } = fakeChild();
  const awake = keepAwake({ platform: "darwin", pid: 1, start: () => child });
  assert.equal(awake.held(), true);
  child.emit("exit", 1);
  assert.equal(awake.held(), false);
});
