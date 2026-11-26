import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evalsDir } from "../../evals/agent-evals/lib.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const smthrs = path.join(repo, ".smithers/node_modules/.bin/smthrs");
const smithersRoot = path.join(repo, ".smithers");

function evalEnv(extra = {}) {
  return {
    ...process.env,
    ...extra
  };
}

function runSmthrs(args, env) {
  return spawnSync(process.execPath, [smthrs, ...args], {
    cwd: repo,
    env: evalEnv(env),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000
  });
}

test("scripts/agent-evals/run.mjs is retired and smthrs eval discovers both suites (#466)", () => {
  assert.equal(existsSync(path.join(evalsDir(repo), "run.mjs")), false);
  const res = runSmthrs(["eval", "list", "--root", smithersRoot, "--format", "json"]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const names = JSON.parse(res.stdout).suites.map((s) => s.name).sort();
  assert.ok(names.includes("agent-evals"), `missing agent-evals in ${names}`);
  assert.ok(names.includes("agent-evals-live"), `missing agent-evals-live in ${names}`);
});

test("agent-evals passes baseline compare and catches reference and base regressions (#466)", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-evals-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // 1. Real suite matches committed baseline
  const runFile = path.join(dir, "ok.json");
  const runOk = runSmthrs(["eval", "run", "agent-evals", "--root", smithersRoot, "--output", runFile, "--format", "json"]);
  assert.equal(runOk.status, 0, runOk.stdout + runOk.stderr);
  const cmpOk = runSmthrs(["eval", "compare", runFile, "--root", smithersRoot, "--format", "json"]);
  assert.equal(cmpOk.status, 0, cmpOk.stdout + cmpOk.stderr);
  assert.equal(JSON.parse(cmpOk.stdout).verdict._tag, "Passed");

  // 2. Negative control: breaking retry/reference (times: 1) fails compare
  const badRefFixtures = path.join(dir, "bad-ref");
  cpSync(path.join(repo, "scripts/agent-evals"), badRefFixtures, { recursive: true });
  const retryRefPath = path.join(badRefFixtures, "tasks/retry/reference/profile.vibe");
  writeFileSync(retryRefPath, readFileSync(retryRefPath, "utf8").replace("times: 3", "times: 1"), "utf8");
  const badRefOut = path.join(dir, "bad-ref.json");
  const runBadRef = runSmthrs(
    ["eval", "run", "agent-evals", "--root", smithersRoot, "--output", badRefOut, "--format", "json"],
    { AGENT_EVALS_FIXTURES_DIR: badRefFixtures }
  );
  assert.equal(runBadRef.status, 0, runBadRef.stdout + runBadRef.stderr);
  const cmpBadRef = runSmthrs(["eval", "compare", badRefOut, "--root", smithersRoot, "--format", "json"]);
  assert.equal(cmpBadRef.status, 1, cmpBadRef.stdout + cmpBadRef.stderr);
  assert.match(cmpBadRef.stdout + cmpBadRef.stderr, /retry\/reference/);

  // 3. Negative control: a base sample that already retries fails compare on retry/base
  const badBaseFixtures = path.join(dir, "bad-base");
  cpSync(path.join(repo, "scripts/agent-evals"), badBaseFixtures, { recursive: true });
  cpSync(
    path.join(badBaseFixtures, "tasks/retry/reference/profile.vibe"),
    path.join(badBaseFixtures, "sample/src/profile.vibe")
  );
  const badBaseOut = path.join(dir, "bad-base.json");
  const runBadBase = runSmthrs(
    ["eval", "run", "agent-evals", "--root", smithersRoot, "--output", badBaseOut, "--format", "json"],
    { AGENT_EVALS_FIXTURES_DIR: badBaseFixtures }
  );
  assert.equal(runBadBase.status, 0, runBadBase.stdout + runBadBase.stderr);
  const cmpBadBase = runSmthrs(["eval", "compare", badBaseOut, "--root", smithersRoot, "--format", "json"]);
  assert.equal(cmpBadBase.status, 1, cmpBadBase.stdout + cmpBadBase.stderr);
  assert.match(cmpBadBase.stdout + cmpBadBase.stderr, /retry\/base/);
});

test("agent-evals-live runs end-to-end with a stubbed claude CLI on PATH spending nothing (#466)", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agent-evals-live-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stubBin = path.join(dir, "bin");
  mkdirSync(stubBin, { recursive: true });
  const claudeStub = path.join(stubBin, "claude");
  writeFileSync(claudeStub, '#!/bin/sh\necho \'{"type":"result","subtype":"stub"}\'\nexit 0\n', "utf8");
  chmodSync(claudeStub, 0o755);

  const outFile = path.join(dir, "live.json");
  const res = runSmthrs(
    ["eval", "run", "agent-evals-live", "--root", smithersRoot, "--output", outFile, "--format", "json"],
    {
      PATH: `${stubBin}:${process.env.PATH ?? ""}`,
      AGENT_EVALS_AGENTS: "claude",
      AGENT_EVALS_TASKS: "retry",
      AGENT_EVALS_CONDITIONS: "without",
      AGENT_EVALS_DIR: path.join(dir, "work")
    }
  );
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.suite, "agent-evals-live");
  assert.equal(parsed.cases.length, 1);
  assert.equal(parsed.cases[0].case, "retry/claude/without");
  assert.equal(parsed.cases[0].observations[0].score, 0);
});
