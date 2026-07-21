import { defineConfig } from "vitest/config";

/** Kept separate from vite.config.ts: the app build and the test runner have no reason to
 *  share a config object, and vitest owns its own schema. */
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    // happy-dom's parser is not as inert as a browser's `DOMParser`. A browser parses an XSS
    // payload into a document with no browsing context, where nothing loads and nothing runs;
    // happy-dom will try. Since the payloads in sanitize.test.ts and security.test.ts are
    // built to look exactly like an attack, the test run must not be allowed to act on them.
    // The remaining `<iframe>` load is left enabled because blocking it only converts the
    // attempt into pages of uncaught-error noise, and the corpus points iframes at `.test`,
    // a reserved TLD that is guaranteed never to resolve.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
        },
      },
    },
  },
});
