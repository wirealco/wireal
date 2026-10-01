// Turns the dist/_headers file the build writes for Cloudflare (see
// scripts/cloudflare-headers.mjs) into nginx `add_header` lines, so a
// self-hosted web container sends the same Content-Security-Policy and
// security headers as wireal.co.
//
//   node docker/web/headers-to-nginx.mjs dist/_headers > headers.conf
//
// The `/*` block becomes headers.conf; the `/assets/*` block becomes
// assets.conf next to it. Strict-Transport-Security loses includeSubDomains
// and preload: those are wireal.co's promise about its own domain, and a
// self-hoster's other subdomains are not this server's to decide.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const source = process.argv[2] || "dist/_headers";
const out = process.argv[3] || dirname(source);
const blocks = new Map();
let current;
for (const line of readFileSync(source, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    current = line.trim();
    blocks.set(current, []);
    continue;
  }
  const colon = line.indexOf(":");
  let name = line.slice(0, colon).trim();
  let value = line.slice(colon + 1).trim();
  if (name.toLowerCase() === "strict-transport-security")
    value = "max-age=63072000";
  blocks.get(current).push([name, value]);
}
const render = (pairs) =>
  pairs
    .map(
      ([name, value]) =>
        `add_header ${name} "${value.replace(/"/g, '\\"')}" always;\n`,
    )
    .join("");
writeFileSync(join(out, "headers.conf"), render(blocks.get("/*") ?? []));
writeFileSync(join(out, "assets.conf"), render(blocks.get("/assets/*") ?? []));
