import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Exit } from "effect";
import effectBump, { layer as effectLayer } from "../flow.ts";
import tsBump, { layer as tsLayer } from "../../ts-bump/flow.ts";
import { execute } from "../../in-process.ts";

const failure = { name: "compiler", command: "compiler", code: 1, seconds: 0, failures: [], output: "compile failed" };
const check = { ok: true, summary: "pass", code: 0, seconds: 0, results: [] };

test("a failed Effect bump writes its report and fails the flow", async (t) => {
  const run = mkdtempSync(join(tmpdir(), "effect-bump-outcome-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const payload = { run, repo: run, version: "4.1.1" };
  const snapshots = {
    options: { ...payload, from: "4.1.0" },
    pin: check,
    literals: check,
    install: check,
    build: { ...check, ok: false, results: [failure] },
    regenerate: check,
    probe: check
  };
  for (const [step, value] of Object.entries(snapshots)) writeFileSync(join(run, step + ".json"), JSON.stringify(value));
  const exit = await execute(effectBump, effectLayer, payload);
  assert.ok(existsSync(join(run, "report.md")));
  assert.ok(Exit.isFailure(exit));
});

test("a TypeScript bump needing a manual merge writes its report and fails the flow", async (t) => {
  const run = mkdtempSync(join(tmpdir(), "ts-bump-outcome-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  const payload = { run, repo: run, to: "next" };
  const snapshots = {
    options: payload,
    fetch: { ...check, from: "1".repeat(40), to: "2".repeat(40) },
    merge: { ok: false, summary: "needs a manual merge", bothAdded: ["tsc/new.go"] },
    regenerate: check,
    build: check,
    probe: check
  };
  for (const [step, value] of Object.entries(snapshots)) writeFileSync(join(run, step + ".json"), JSON.stringify(value));
  const exit = await execute(tsBump, tsLayer, payload);
  assert.ok(existsSync(join(run, "report.md")));
  assert.ok(Exit.isFailure(exit));
});
