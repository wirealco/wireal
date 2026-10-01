import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { version } from "./version.ts";

test("the version the docs and the MCP server print is the one that ships", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  assert.equal(version, manifest.version);
});
