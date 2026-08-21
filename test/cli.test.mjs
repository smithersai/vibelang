import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function run(file, args) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("vibec forwards raw TypeScript CLI flags", () => {
  const result = run("bin/vibec.js", ["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 7\.0\./);
});

test("vibec type-checks ordinary TypeScript", () => {
  const result = run("bin/vibec.js", ["--noEmit", "test/fixtures/basic.ts"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Incur CLI publishes its command surface", () => {
  const result = run("bin/vibe.js", ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compile/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /format/);
});

test("Incur check command delegates to the compiler", () => {
  const result = run("bin/vibe.js", ["check", "test/fixtures/basic.ts", "--strict"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("unfinished commands fail explicitly", () => {
  const result = run("bin/vibe.js", ["format"]);
  assert.equal(result.status, 2);
  assert.match(result.stdout + result.stderr, /NOT_IMPLEMENTED|not implemented/);
});
