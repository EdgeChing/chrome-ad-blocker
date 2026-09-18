import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "coverage/", "openspec/"],
  },
  js.configs.recommended,
  {
    // Extension runtime files: classic scripts in browser / service-worker context.
    files: ["background.js", "classify.js", "content.js", "popup/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.webextensions,
        // Cross-script runtime global published by classify.js (content-script
        // isolated world + SW importScripts context).
        AdClassify: "readonly",
      },
    },
  },
  {
    // Node-side tooling: config files and (Phase 4) tests under test/.
    files: ["*.config.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
];
