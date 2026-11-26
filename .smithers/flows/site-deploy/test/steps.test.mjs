import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { run, start } from "../lib/steps.mjs";

function makeFixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "site-deploy-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  const state = path.join(dir, "state");
  const creds = path.join(dir, "creds.txt");
  const calls = path.join(dir, "calls.log");
  mkdirSync(repo, { recursive: true });
  writeFileSync(creds, "tok-secret-123\nacc-secret-456\n", { mode: 0o600 });

  const runAll = (overrides = {}) => {
    start(state, {
      repo,
      credentials: creds,
      mainCmd: "printf '%s\\n' \"${TEST_MAIN:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}\"",
      npmCmd: "printf '%s\\n' \"${TEST_NPM:-0.0.13}\"",
      checkoutCmd: `mkdir -p "$SITE_DEPLOY_WS" && echo "checkout:$SITE_DEPLOY_MAIN:$CLOUDFLARE_API_TOKEN:$CLOUDFLARE_ACCOUNT_ID" >> ${JSON.stringify(calls)}`,
      regenerateCmd: `echo "regenerate:$SITE_DEPLOY_MAIN:$CLOUDFLARE_API_TOKEN:$CLOUDFLARE_ACCOUNT_ID" >> ${JSON.stringify(calls)}`,
      deployCmd: `echo "deploy:$SITE_DEPLOY_MAIN:$SITE_DEPLOY_NPM:$SITE_DEPLOY_DRY_RUN:$CLOUDFLARE_API_TOKEN:$CLOUDFLARE_ACCOUNT_ID" >> ${JSON.stringify(calls)}`,
      ...overrides
    });
    const out = {};
    for (const step of ["check", "checkout", "regenerate", "deploy", "record"]) {
      out[step] = run[step](state);
    }
    return out;
  };

  const readCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []);
  const readDeployed = () => (existsSync(path.join(state, "deployed.json")) ? JSON.parse(readFileSync(path.join(state, "deployed.json"), "utf8")) : null);
  return { dir, repo, state, creds, calls, runAll, readCalls, readDeployed };
}

test("deploys on first run and records main and npm version", (t) => {
  const f = makeFixture(t);
  const out = f.runAll();
  assert.equal(out.check.skipped, false);
  assert.equal(out.deploy.ok, true);
  assert.equal(f.readCalls().length, 3);
  const deployed = f.readDeployed();
  assert.equal(deployed.main, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(deployed.npm, "0.0.13");
});

test("skips checkout, regenerate, deploy and record when unchanged", (t) => {
  const f = makeFixture(t);
  f.runAll();
  assert.equal(f.readCalls().length, 3);
  const second = f.runAll();
  assert.equal(second.check.skipped, true);
  assert.equal(second.checkout.skipped, true);
  assert.equal(second.regenerate.skipped, true);
  assert.equal(second.deploy.skipped, true);
  assert.equal(second.record.skipped, true);
  assert.equal(f.readCalls().length, 3, "no deploy commands run when unchanged");
});

test("redeploys when main moves", (t) => {
  const f = makeFixture(t);
  f.runAll();
  const next = f.runAll({ mainCmd: "printf 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\\n'" });
  assert.equal(next.check.skipped, false);
  assert.equal(f.readCalls().length, 6);
  assert.equal(f.readDeployed().main, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("redeploys when npm latest version moves", (t) => {
  const f = makeFixture(t);
  f.runAll();
  const next = f.runAll({ npmCmd: "printf '0.0.14\\n'" });
  assert.equal(next.check.skipped, false);
  assert.equal(f.readCalls().length, 6);
  assert.equal(f.readDeployed().npm, "0.0.14");
});

test("deploy failure records nothing so the next run retries", (t) => {
  const f = makeFixture(t);
  assert.throws(() => f.runAll({ deployCmd: "echo boom >&2; exit 1" }), /deploy failed/);
  assert.equal(f.readDeployed(), null, "failed deploy must not write deployed.json");
  const retry = f.runAll();
  assert.equal(retry.check.skipped, false);
  assert.equal(f.readDeployed().main, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
});

test("dry run skips credentials and records nothing", (t) => {
  const f = makeFixture(t);
  const out = f.runAll({ dryRun: true, credentials: "" });
  assert.match(out.record.summary, /dry run.*nothing recorded/);
  assert.equal(f.readDeployed(), null);
  const deployLine = f.readCalls().find((line) => line.startsWith("deploy:"));
  assert.equal(deployLine, "deploy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0.0.13:1::");
});

test("credentials reach only deploy and never check, checkout or regenerate", (t) => {
  const f = makeFixture(t);
  f.runAll();
  const lines = f.readCalls();
  assert.equal(lines[0], "checkout:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::");
  assert.equal(lines[1], "regenerate:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa::");
  assert.equal(lines[2], "deploy:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0.0.13:0:tok-secret-123:acc-secret-456");
});

test("unreadable main or npm fails check before any downstream step", (t) => {
  const f = makeFixture(t);
  assert.throws(() => f.runAll({ mainCmd: "exit 1" }), /unable to resolve/);
  assert.throws(() => f.runAll({ npmCmd: "exit 1" }), /unable to resolve published npm version/);
  assert.equal(f.readCalls().length, 0);
});
