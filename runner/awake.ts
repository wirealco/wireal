import { spawn, type ChildProcess } from "node:child_process";

export type Awake = {
  held: () => boolean;
  why: string;
  release: () => void;
};

export type AwakeParts = {
  platform?: NodeJS.Platform;
  pid?: number;
  start?: (command: string, args: string[]) => ChildProcess | undefined;
};

export const watchEvery = 30;

export function awakeCommand(
  platform: NodeJS.Platform,
  pid: number,
): { command: string; args: string[] } | undefined {
  if (platform === "darwin")
    return { command: "caffeinate", args: ["-i", "-w", String(pid)] };
  if (platform === "win32")
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "Add-Type -Name Awake -Namespace Wireal -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);';",
          "[Wireal.Awake]::SetThreadExecutionState(0x80000001) | Out-Null;",
          `while (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds ${watchEvery} }`,
        ].join(" "),
      ],
    };
  return {
    command: "systemd-inhibit",
    args: [
      "--what=idle:sleep",
      "--who=Wireal runner",
      "--why=An agent is at work",
      "--mode=block",
      "sh",
      "-c",
      `while kill -0 ${pid} 2>/dev/null; do sleep ${watchEvery}; done`,
    ],
  };
}

export function keepAwake(parts: AwakeParts = {}): Awake {
  const platform = parts.platform ?? process.platform;
  const pid = parts.pid ?? process.pid;
  const asked = awakeCommand(platform, pid);
  const why =
    platform === "darwin"
      ? "caffeinate"
      : platform === "win32"
        ? "Windows power request"
        : "systemd-inhibit";
  if (!asked) return { held: () => false, why: "", release: () => {} };
  const start =
    parts.start ??
    ((command: string, args: string[]) => {
      try {
        const child = spawn(command, args, {
          stdio: "ignore",
          windowsHide: true,
        });
        child.on("error", () => {});
        child.unref();
        return child;
      } catch {
        return undefined;
      }
    });
  const child = start(asked.command, asked.args);
  let gone = !child;
  child?.on("exit", () => {
    gone = true;
  });
  return {
    held: () => !gone,
    why,
    release: () => {
      if (gone || !child) return;
      gone = true;
      try {
        child.kill();
      } catch {
        return;
      }
    },
  };
}
