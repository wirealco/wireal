import { execFileSync } from "node:child_process";

export type NameParts = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: (command: string, args: string[]) => string;
};

export const nameLimit = 48;
export const askTimeout = 1_500;
export const ownNames =
  /^(wireal-run|wireal|npx|npm|node|tsx|zsh|bash|fish|sh|login|claude|codex|cmd|cmd\.exe|powershell|pwsh|command prompt|windows powershell|administrator|select|conhost|wsl)\b/i;

export function programs(
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32"
    ? [`${command}.cmd`, `${command}.exe`, command]
    : [command];
}

function ask(parts: NameParts, command: string, args: string[]): string {
  const run =
    parts.run ??
    ((program: string, argv: string[]) =>
      execFileSync(program, argv, {
        encoding: "utf8",
        timeout: askTimeout,
        stdio: ["ignore", "pipe", "ignore"],
      }));
  for (const program of programs(command, parts.platform ?? process.platform)) {
    try {
      return run(program, args);
    } catch {
      continue;
    }
  }
  return "";
}

export function pathLike(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.startsWith("/")
  );
}

export function cleanName(value: string): string {
  const plain = value
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain || ownNames.test(plain) || pathLike(plain)) return "";
  return plain.length > nameLimit ? plain.slice(0, nameLimit).trim() : plain;
}

export function tmuxName(parts: NameParts = {}): string {
  const env = parts.env ?? process.env;
  if (!env.TMUX?.trim()) return "";
  return cleanName(ask(parts, "tmux", ["display-message", "-p", "#W"]));
}

export function screenName(parts: NameParts = {}): string {
  const session = (parts.env ?? process.env).STY?.trim();
  if (!session) return "";
  return cleanName(session.replace(/^\d+\./, ""));
}

export function orcaName(parts: NameParts = {}): string {
  const env = parts.env ?? process.env;
  const handle = env.ORCA_TERMINAL_HANDLE?.trim();
  if (!handle) return "";
  const said = ask(parts, "orca", [
    "terminal",
    "show",
    "--terminal",
    handle,
    "--json",
  ]);
  try {
    const parsed = JSON.parse(said) as {
      result?: { terminal?: { title?: unknown } };
    };
    const title = parsed.result?.terminal?.title;
    return typeof title === "string" ? cleanName(title) : "";
  } catch {
    return "";
  }
}

export function windowsName(parts: NameParts = {}): string {
  const env = parts.env ?? process.env;
  if ((parts.platform ?? process.platform) !== "win32") return "";
  const task = cleanName(env.ConEmuTask ?? "");
  if (task) return task;
  for (const shell of ["powershell", "pwsh"]) {
    const name = cleanName(
      ask(parts, shell, [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Console]::Title",
      ]),
    );
    if (name) return name;
  }
  return "";
}

export function terminalName(parts: NameParts = {}): string {
  for (const found of [tmuxName, screenName, orcaName, windowsName]) {
    const name = found(parts);
    if (name) return name;
  }
  return "";
}
