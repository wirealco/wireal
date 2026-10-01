import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Cloudflare Web Analytics, injected at build time and only when a site token
 * is configured. The hosted wireal.co build does not set one: its zone uses
 * Cloudflare's automatic injection, which adds the same beacon at the edge,
 * and sets VITE_CF_WEB_ANALYTICS=edge so scripts/cloudflare-headers.mjs admits
 * the Insights origins in the CSP. This plugin exists for a deployment that cannot use
 * automatic injection; setting the token on the production build would emit
 * a second beacon and double-count. The beacon is cookieless and is added as
 * an external script tag appended to <head>, so the two inline scripts
 * already in index.html are left byte for byte as they are for the CSP
 * hashes computed after the build.
 *
 * `spa` makes the beacon count client-side route changes as page views; the
 * app is a React Router SPA, so without it only the first load would count.
 */
function cloudflareBeacon(token: string): Plugin | null {
  if (!token) return null;
  // The token lands inside a single-quoted attribute holding JSON. Cloudflare
  // issues 32 hexadecimal characters; anything else is a copy mistake, and
  // refusing it beats shipping a beacon that cannot report.
  if (!/^[A-Za-z0-9_-]+$/.test(token))
    throw new Error(
      "VITE_CF_BEACON_TOKEN must be the Web Analytics site token: letters, digits, '-' or '_' only.",
    );
  return {
    name: "wireal:cloudflare-beacon",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      // A string replacement rather than Vite's tag descriptors: those
      // serialise attributes with double quotes and entity-escape the JSON,
      // which browsers read fine but people and the Cloudflare docs do not.
      // Nothing before </head> is touched, so the inline scripts keep their
      // bytes and their hashes.
      handler: (html) =>
        html.replace(
          "</head>",
          `  <script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token, spa: true })}'></script>\n  </head>`,
        ),
    },
  };
}

/**
 * Ships the licence and the third-party notices beside the built app, so the
 * notices that Apache-2.0 and MIT packages require travel with the bundle that
 * contains them. They are served at /LICENSE.txt and /THIRD_PARTY_NOTICES.txt.
 */
function legalFiles(): Plugin {
  return {
    name: "wireal:legal-files",
    apply: "build",
    generateBundle() {
      for (const [source, fileName] of [
        ["LICENSE", "LICENSE.txt"],
        ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
      ])
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(source, "utf8"),
        });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const localPreview = command === "serve" && mode === "development";
  const beacon = cloudflareBeacon(
    localPreview ? "" : env.VITE_CF_BEACON_TOKEN?.trim() || "",
  );
  const shared = {
    plugins: [
      react(),
      tailwindcss(),
      legalFiles(),
      ...(beacon ? [beacon] : []),
    ],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(
        localPreview ? "" : env.VITE_API_URL?.trim() || "https://api.wireal.co",
      ),
      // Shown in the docs and on the landing page; a self-hosted build points
      // it at its own MCP server.
      "import.meta.env.VITE_MCP_URL": JSON.stringify(
        env.VITE_MCP_URL?.trim() || "https://mcp.wireal.co/mcp",
      ),
    },
  };
  if (command !== "serve") return shared;
  return {
    ...shared,
    server: { host: "localhost", port: 5174, strictPort: true },
  };
});
