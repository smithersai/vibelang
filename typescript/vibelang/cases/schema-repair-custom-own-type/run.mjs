import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const compiler = path.resolve(here, "../../../built/local/tsc");
const dir = fs.mkdtempSync(path.join(here, ".repair-"));
try {
  for (const name of ["custom.ts", "package.json", "tsconfig.json"]) {
    fs.copyFileSync(path.join(here, name), path.join(dir, name));
  }
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir");
  // The consumer must be added after the edit: an original consumer could
  // make the speculative CLI gate refuse an otherwise unsafe suggestion.
  const original = fs.readFileSync(path.join(here, "main.vibe"), "utf8");
  const source = original.replace('export const sentinel: User = "sentinel";\n', "");
  fs.writeFileSync(path.join(dir, "main.vibe"), source);
  const run = (...args) => {
    const result = spawnSync(compiler, ["-p", dir, ...args], { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  run("--fix");
  const fixed = fs.readFileSync(path.join(dir, "main.vibe"), "utf8");
  assert.match(fixed, /export type User = Schema\.Schema\.Type<typeof User>;/);
  assert.doesNotMatch(fixed, /schema User/);
  fs.appendFileSync(path.join(dir, "main.vibe"), '\nexport const sentinel: User = "sentinel";\n');
  run();
  console.log("ok");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
