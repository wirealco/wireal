import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const usage = `Usage: npm run shot -- <route> [route...] [options]

Routes carry no leading slash: home docs docs/runner privacy terms.

  --width=1440,390   viewport widths, one shot per width (default 1440)
  --dark             render in the dark colour scheme
  --full             full page instead of the viewport
  --scroll=bottom    scroll to the foot of the page before shooting
  --preview          build and serve dist instead of the dev server
  --out=.shots       where the PNGs land`;

function parse(argv) {
  const routes = [];
  const widths = [];
  const options = {
    dark: false,
    full: false,
    scroll: "",
    preview: false,
    out: ".shots",
  };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      routes.push(argument);
      continue;
    }
    const [name, value = ""] = argument.slice(2).split("=");
    if (name === "width")
      widths.push(
        ...value
          .split(",")
          .map((one) => Number(one.trim()))
          .filter((one) => one > 0),
      );
    else if (name === "dark") options.dark = true;
    else if (name === "full") options.full = true;
    else if (name === "scroll") options.scroll = value || "bottom";
    else if (name === "preview") options.preview = true;
    else if (name === "out") options.out = value || ".shots";
    else if (name === "help") {
      console.log(usage);
      process.exit(0);
    } else {
      console.error(`Unknown option --${name}.\n\n${usage}`);
      process.exit(1);
    }
  }
  return {
    ...options,
    routes: routes.length ? routes : ["home"],
    widths: widths.length ? widths : [1440],
  };
}

function pathOf(route) {
  const trimmed = route.replace(/^\/+/, "").trim();
  return !trimmed || trimmed === "home" || trimmed === "index"
    ? "/"
    : `/${trimmed}`;
}

function nameOf(route) {
  const path = pathOf(route);
  return path === "/" ? "home" : path.slice(1).replace(/\//g, "-");
}

function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

function viteEntry() {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("vite/package.json");
  const bin = require(manifest).bin;
  return resolve(dirname(manifest), typeof bin === "string" ? bin : bin.vite);
}

function build() {
  const windows = process.platform === "win32";
  const file = windows
    ? process.env.ComSpec || "cmd.exe"
    : process.env.SHELL || "/bin/sh";
  const args = windows
    ? ["/d", "/s", "/c", "npm run build"]
    : ["-c", "npm run build"];
  return new Promise((done, fail) => {
    const child = spawn(file, args, { cwd: root, stdio: "inherit" });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? done()
        : fail(new Error(`npm run build exited with ${code}`)),
    );
  });
}

function serve(port, preview) {
  const args = [
    viteEntry(),
    ...(preview ? ["preview"] : []),
    "--port",
    String(port),
    "--strictPort",
    "--host",
    "127.0.0.1",
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  return { child, tail: () => log.trim().split("\n").slice(-5).join("\n") };
}

async function ready(server, url) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (server.child.exitCode !== null)
      throw new Error(
        `The server stopped before it answered.\n${server.tail()}`,
      );
    try {
      const answer = await fetch(url, { redirect: "manual" });
      if (answer.status < 500) return;
    } catch {}
    if (Date.now() > deadline)
      throw new Error(
        `Nothing answered on ${url} within a minute.\n${server.tail()}`,
      );
    await new Promise((done) => setTimeout(done, 200));
  }
}

const options = parse(process.argv.slice(2));

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error(
    "playwright-core is missing. Run npm install in this worktree, then try again.",
  );
  process.exit(1);
}

if (options.preview) await build();

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = serve(port, options.preview);
const stop = () => server.child.kill();
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

const written = [];
let browser;
try {
  await ready(server, `${base}/`);
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (/Executable doesn't exist/i.test(String(error)))
      throw new Error(
        "No Chromium build is cached. Run: node node_modules/playwright-core/cli.js install chromium",
      );
    throw error;
  }
  const out = resolve(root, options.out);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const width of options.widths) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: options.dark ? "dark" : "light",
    });
    for (const route of options.routes) {
      await page.goto(base + pathOf(route), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      if (options.scroll === "bottom") {
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight),
        );
        await page.waitForTimeout(400);
      }
      await page.waitForTimeout(300);
      const file = join(
        out,
        `${nameOf(route)}-${width}${options.dark ? "-dark" : ""}${options.full ? "-full" : ""}.png`,
      );
      await page.screenshot({ path: file, fullPage: options.full });
      written.push(file);
    }
    await page.close();
  }
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  await browser?.close();
  stop();
  process.exit(1);
} finally {
  await browser?.close();
  stop();
}

console.log(written.map((file) => relative(root, file)).join("\n"));
console.log(
  `\n${written.length} shot${written.length === 1 ? "" : "s"}. Read the two or three that answer your question, not all of them.`,
);
