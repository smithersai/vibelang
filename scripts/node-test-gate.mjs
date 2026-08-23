#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { repositoryRoot } from "./fork-e2e.mjs";

async function main() {
  const testDirectory = join(repositoryRoot, "test");
  const testFiles = (await readdir(testDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => join("test", entry.name))
    .sort();
  if (testFiles.length === 0) {
    process.stderr.write("Node test gate failed: test/ contains no *.test.mjs files.\n");
    return 1;
  }

  process.stdout.write(`Node test preflight: running ${testFiles.length} test files.\n`);
  const child = spawn(process.execPath, ["--test", ...testFiles], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  return new Promise((resolve) => {
    child.once("error", (error) => {
      process.stderr.write(`Node test gate failed to start: ${error.message}\n`);
      resolve(1);
    });
    child.once("close", (code, signal) => {
      if (signal) process.stderr.write(`Node test gate ended from signal ${signal}.\n`);
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`Node test gate failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  },
);
