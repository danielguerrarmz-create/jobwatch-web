import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * The allowlist of hosts the page may talk to. This is the same list as `ALLOWED_HOSTS` in
 * src/lib/ats.ts, enforced a second time by the browser itself. Application code can have a
 * bug; a CSP cannot be talked out of it. Adding a board means editing both places.
 */
const CONNECT_SRC = [
  "https://boards-api.greenhouse.io",
  "https://api.lever.co",
  "https://api.ashbyhq.com",
  "https://api.smartrecruiters.com",
  "https://apply.workable.com",
  "https://*.recruitee.com",
].join(" ");

function policy(scriptHashes: string[]): string {
  return [
    "default-src 'none'",
    // The one inline script (pre-paint theme selection) is allowed by hash, not by
    // 'unsafe-inline'. Editing that script changes the hash and the build re-derives it,
    // so the policy cannot silently drift away from what is actually on the page.
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    // Vite emits a stylesheet file, but React still sets a few inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${CONNECT_SRC}`,
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'self'",
  ].join("; ");
}

/**
 * Production-only CSP injection. The dev server needs an inline script for React Fast
 * Refresh, so shipping the strict policy in the source `index.html` would make `npm run dev`
 * fail in a confusing way. Build output gets the real thing.
 *
 * Note `frame-ancestors` is absent: it is ignored in a `<meta>` policy and has to be a real
 * response header. See `docs/deploy.md` for the header set to configure at the host.
 */
function cspPlugin(): Plugin {
  return {
    name: "jobwatch-csp",
    apply: "build",
    async transformIndexHtml(html) {
      const { createHash } = await import("node:crypto");
      const hashes: string[] = [];
      // Match only scripts with no `src`, i.e. genuinely inline bodies.
      const inline = html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi);
      for (const match of inline) {
        const body = match[1];
        if (!body.trim()) continue;
        hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
      }
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy(hashes)}" />`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  // Relative base so the built site works from a subpath (GitHub Pages project sites) and
  // from a plain `file://` open, without a rebuild.
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
  },
});
