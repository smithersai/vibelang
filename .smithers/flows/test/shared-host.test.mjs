// Verifies the shared durable Smithers flow host (`.smithers/flows/host.ts`, #477):
// - defaults to the workspace durable SQLite store (`.flows/{engine,control}.db`)
//   so `smthrs runs list` observes every execution across Bun and Node
// - coexists cleanly with `smthrs flow start` in the same `.flows/` directory
// - records failed runs as `failed` rather than leaving stale running rows
// - supports `--memory` / `{ memory: true }` for isolated tests with zero disk state
// - remains the sole `FlowEngine.layerMemory` composition root under `.smithers/flows/`
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Exit } from "effect";
import ciHealth, { layer as ciHealthLayer } from "../ci-health/flow.ts";
import docs, { layer as docsLayer } from "../docs/flow.ts";
import { readSources } from "../docs/generate.ts";
import { execute, parseHostFlags } from "../host.ts";
import { hostGap } from "./durable-host-gap.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const smithers = path.resolve(here, "../..");
const hostScript = path.join(smithers, "flows/host.ts");
const cliPkgPath = path.join(smithers, "node_modules/@smthrs/cli/package.json");
const ciHealthFixture = path.join(smithers, "flows/ci-health/fixture");

function tempProject(t, { withCiHealth = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "shared-host-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), "{}\n");
  if (withCiHealth) {
    mkdirSync(path.join(root, ".smithers/flows"), { recursive: true });
    cpSync(path.join(smithers, "flows/ci-health"), path.join(root, ".smithers/flows/ci-health"), { recursive: true });
    cpSync(path.join(smithers, "package.json"), path.join(root, ".smithers/package.json"));
    symlinkSync(path.join(smithers, "node_modules"), path.join(root, ".smithers/node_modules"));
    mkdirSync(path.join(root, ".flows"), { recursive: true });
  }
  return root;
}

function smthrs(root, ...args) {
  const { bin } = JSON.parse(readFileSync(cliPkgPath, "utf8"));
  const entry = path.join(path.dirname(cliPkgPath), typeof bin === "string" ? bin : bin.smthrs);
  const result = spawnSync(process.execPath, [entry, ...args, "--root", root, "--format", "json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: () => JSON.parse(result.stdout),
  };
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

test("parseHostFlags extracts host flags while preserving flow arguments", () => {
  const parsed = parseHostFlags([
    "--run", "/tmp/r",
    "--memory",
    "--root", "/tmp/ws",
    "--db=/tmp/ws/custom.db",
    "--execution-id", "run-42",
    "--package", "packages/a",
    "--", "--memory",
  ]);
  assert.deepEqual(parsed.options, {
    memory: true,
    root: path.resolve("/tmp/ws"),
    db: path.resolve("/tmp/ws/custom.db"),
    executionId: "run-42",
  });
  assert.deepEqual(parsed.rest, ["--run", "/tmp/r", "--package", "packages/a", "--", "--memory"]);
});

test("host.ts is the sole FlowEngine.layerMemory composition root under .smithers/flows/", () => {
  const flowsDir = path.join(smithers, "flows");
  const matches = [];
  for (const file of walkFiles(flowsDir)) {
    if (!/\.(ts|mts|js|mjs)$/.test(file)) continue;
    if (file === fileURLToPath(import.meta.url)) continue;
    if (readFileSync(file, "utf8").includes("FlowEngine.layerMemory")) {
      matches.push(path.relative(flowsDir, file));
    }
  }
  assert.deepEqual(matches, ["host.ts"]);
});

test("memory mode executes ci-health and docs with zero .flows/ disk state", async (t) => {
  const root = tempProject(t);
  const runDir = path.join(root, "run-mem");
  const ciExit = await execute(ciHealth, ciHealthLayer, { run: runDir, results: ciHealthFixture }, { memory: true, root });
  assert.ok(Exit.isSuccess(ciExit), Exit.isFailure(ciExit) ? String(ciExit.cause) : "");
  assert.ok(existsSync(path.join(runDir, "report.md")));
  assert.equal(existsSync(path.join(root, ".flows")), false, "memory mode must not create .flows/");

  const sources = await readSources();
  const docsExit = await execute(docs, docsLayer, { sources }, { memory: true, root });
  assert.ok(Exit.isSuccess(docsExit), Exit.isFailure(docsExit) ? String(docsExit.cause) : "");
  assert.ok("AGENTS.md" in docsExit.value);
  assert.equal(existsSync(path.join(root, ".flows")), false, "memory mode must not create .flows/");
});

test("durable mode persists ci-health and docs runs into SQLite and smthrs runs list observes them", async (t) => {
  const root = tempProject(t);
  const runDir = path.join(root, "run-ci");

  const ciExit = await execute(
    ciHealth,
    ciHealthLayer,
    { run: runDir, results: ciHealthFixture },
    { root, executionId: "shared-host-ci-1" },
  );
  assert.ok(Exit.isSuccess(ciExit), Exit.isFailure(ciExit) ? String(ciExit.cause) : "");
  assert.ok(existsSync(path.join(runDir, "report.md")));
  assert.ok(existsSync(path.join(root, ".flows/engine.db")));
  assert.ok(existsSync(path.join(root, ".flows/control.db")));

  const sources = await readSources();
  const docsExit = await execute(docs, docsLayer, { sources }, { root, executionId: "shared-host-docs-1" });
  assert.ok(Exit.isSuccess(docsExit), Exit.isFailure(docsExit) ? String(docsExit.cause) : "");
  assert.ok("CONTRIBUTING.md" in docsExit.value);

  const listed = smthrs(root, "runs", "list", "--sort", "oldest");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    listed.json().items.map((item) => ({
      runId: item.runId,
      flowId: item.flowId,
      status: item.status,
      observed: item.executionObservation,
      engineStatus: item.executionView?.current?.status,
    })),
    [
      { runId: "shared-host-ci-1", flowId: "ci-health", status: "completed", observed: "observed", engineStatus: "completed" },
      { runId: "shared-host-docs-1", flowId: "docs", status: "completed", observed: "observed", engineStatus: "completed" },
    ],
  );
});

test("durable mode records failed runs as failed in smthrs runs list", async (t) => {
  const root = tempProject(t);
  const missing = path.join(root, "does-not-exist");
  const exit = await execute(
    ciHealth,
    ciHealthLayer,
    { run: path.join(root, "run-fail"), results: missing },
    { root, executionId: "shared-host-fail-1" },
  );
  assert.ok(Exit.isFailure(exit));

  const listed = smthrs(root, "runs", "list");
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    listed.json().items.map(({ runId, flowId, status }) => ({ runId, flowId, status })),
    [{ runId: "shared-host-fail-1", flowId: "ci-health", status: "failed" }],
  );
});

test("shared host CLI works under Bun and coexists with smthrs flow start in the same .flows/ store", (t) => {
  const root = tempProject(t, { withCiHealth: true });
  const run1 = path.join(root, "run-bun");
  const bunRun = spawnSync(
    "bun",
    [
      hostScript,
      "ci-health",
      "--root", root,
      "--execution-id", "bun-cli-ci-1",
      "--data", JSON.stringify({ run: run1, results: ciHealthFixture }),
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(bunRun.status, 0, bunRun.stderr);
  assert.equal(JSON.parse(bunRun.stdout).ok, true);

  const run2 = path.join(root, "run-smthrs");
  const started = smthrs(
    root,
    "flow", "start", "ci-health",
    "--data", JSON.stringify({ run: run2, results: path.join(root, ".smithers/flows/ci-health/fixture") }),
  );
  const gap = hostGap(started.stdout + started.stderr);
  if (gap !== undefined) {
    t.skip(gap);
    return;
  }
  assert.equal(started.status, 0, started.stdout + started.stderr);

  const listed = smthrs(root, "runs", "list", "--sort", "oldest");
  assert.equal(listed.status, 0, listed.stderr);
  const items = listed.json().items;
  assert.equal(items.length, 2, JSON.stringify(items));
  assert.equal(items[0].runId, "bun-cli-ci-1");
  assert.equal(items[0].status, "completed");
  assert.equal(items[1].flowId, "ci-health");
  assert.equal(items[1].status, "completed");
});
