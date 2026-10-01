import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type BrowserReport = {
  ready: boolean;
  downloaded: boolean;
  reason: string;
};

export type InstallRun = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; output: string }>;

export const runInstall: InstallRun = (command, args, cwd) =>
  new Promise((done) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", (error) => done({ code: 1, output: error.message }));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });

export const browserCli = (repo: string) =>
  join(repo, "node_modules", "playwright-core", "cli.js");

function firstLine(output: string): string {
  return output.trim().split("\n").filter(Boolean).slice(-1)[0] ?? "";
}

export type BrowserParts = {
  run?: InstallRun;
  exists?: (file: string) => boolean;
  node?: string;
};

export async function readyBrowser(
  repo: string,
  parts: BrowserParts = {},
): Promise<BrowserReport> {
  const exists = parts.exists ?? existsSync;
  const run = parts.run ?? runInstall;
  const cli = browserCli(repo);
  if (!exists(cli))
    return {
      ready: false,
      downloaded: false,
      reason: "playwright-core is not installed, so npm run shot cannot run",
    };
  const result = await run(
    parts.node ?? process.execPath,
    [cli, "install", "chromium"],
    repo,
  );
  if (result.code !== 0)
    return {
      ready: false,
      downloaded: false,
      reason:
        firstLine(result.output) || "playwright could not install chromium",
    };
  return {
    ready: true,
    downloaded: /downloaded to|downloading/i.test(result.output),
    reason: "",
  };
}
