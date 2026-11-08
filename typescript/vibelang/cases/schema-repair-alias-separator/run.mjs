// run-seconds: 120
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { Schema } from "effect";

const here = path.dirname(fileURLToPath(import.meta.url));
const compiler = path.resolve(here, "../../../built/local/tsc");
const dir = fs.mkdtempSync(path.join(here, ".repair-"));
try {
  for (const name of ["main.vibe", "package.json", "tsconfig.json"]) {
    fs.copyFileSync(path.join(here, name), path.join(dir, name));
  }
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir");
  const run = (...args) => {
    const result = spawnSync(compiler, ["-p", dir, ...args], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  run();
  const before = await import(pathToFileURL(path.join(dir, "out/main.js")).href + "?before");
  assert.equal(before.X, Schema.String);
  console.log("ok");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
