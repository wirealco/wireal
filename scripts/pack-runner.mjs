import { build } from "esbuild";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "dist-runner");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const runtime = [
  "@modelcontextprotocol/server",
  "@xterm/headless",
  "node-pty",
  "zod",
];

const entries = [
  { from: "runner/cli.ts", to: "bin/wireal-run.mjs", shebang: true },
  { from: "runner/mcp-stdio.ts", to: "bin/mcp-stdio.mjs", shebang: false },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "bin"), { recursive: true });

for (const entry of entries) {
  await build({
    entryPoints: [join(root, entry.from)],
    outfile: join(out, entry.to),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    // Keep the licence headers of anything bundled in; they go to the end of
    // each file rather than being dropped.
    legalComments: "eof",
    logLevel: "warning",
  });
  const path = join(out, entry.to);
  const code = readFileSync(path, "utf8").replace(/^#![^\n]*\n/, "");
  writeFileSync(path, entry.shebang ? `#!/usr/bin/env node\n${code}` : code, {
    mode: entry.shebang ? 0o755 : 0o644,
  });
}

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "wireal-run",
      version: manifest.version,
      description:
        "Run Claude Code and Codex agents on your machine against a Wireal workspace.",
      license: "AGPL-3.0-only",
      homepage: "https://wireal.co/docs",
      repository: {
        type: "git",
        url: "git+https://github.com/wirealco/wireal.git",
      },
      type: "module",
      bin: { "wireal-run": "bin/wireal-run.mjs" },
      files: ["bin", "hooks", "README.md"],
      engines: { node: ">=22" },
      dependencies: Object.fromEntries(
        runtime.map((name) => [name, manifest.dependencies[name]]),
      ),
    },
    null,
    2,
  ) + "\n",
);

cpSync(join(root, "runner", "hooks"), join(out, "hooks"), { recursive: true });
cpSync(join(root, "runner", "README.md"), join(out, "README.md"));
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

const wanted = readdirSync(join(root, "runner", "hooks")).filter((name) =>
  name.endsWith(".cjs"),
);
const shipped = readdirSync(join(out, "hooks"));
const missing = wanted.filter((name) => !shipped.includes(name));
if (missing.length)
  throw new Error(
    `the runner resolves its hooks beside the bundle, and these did not ship: ${missing.join(", ")}`,
  );

console.log(`wireal-run ${manifest.version} packed into ${out}`);
