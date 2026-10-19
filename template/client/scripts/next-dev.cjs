#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

// Heap cap for the dev server, in MB. Webpack dev keeps every compiled route in
// memory, so the old 768 MB cap ran out after a handful of pages and the server
// crashed. 2048 leaves room for a normal app; set NEXT_DEV_MAX_OLD_SPACE_SIZE
// (or --max-old-space-size in NODE_OPTIONS) to change it per machine.
const DEFAULT_MAX_OLD_SPACE_SIZE = "2048";
const nextBin = require.resolve("next/dist/bin/next");

function applyOldSpaceLimit(nodeOptions, sizeMb) {
  if (/(^|\s)--max[-_]old[-_]space[-_]size(=|\s|$)/.test(nodeOptions)) {
    return nodeOptions;
  }

  return [nodeOptions, `--max-old-space-size=${sizeMb}`].filter(Boolean).join(" ").trim();
}

const env = { ...process.env };
env.NEXT_DISABLE_MEM_OVERRIDE = "1";
env.NODE_OPTIONS = applyOldSpaceLimit(
  env.NODE_OPTIONS || "",
  env.NEXT_DEV_MAX_OLD_SPACE_SIZE || DEFAULT_MAX_OLD_SPACE_SIZE,
);

const args = [
  nextBin,
  "dev",
  "--webpack",
  "--disable-source-maps",
  "--no-server-fast-refresh",
  ...process.argv.slice(2),
];

const child = spawn(process.execPath, args, { stdio: "inherit", env });

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
