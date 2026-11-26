import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(path.join(repo, ".smithers/package.json"));
const CronTarget = require("@smthrs/targets/CronTarget");
const Target = require("@smthrs/targets/Target");
const { openPackageIndex } = require("@smthrs/build-cli/Cli");

const EXPECTED = {
  "//:schedule-coverage-census": { schedule: "0,30 * * * *", run: "//:spec-coverage-census" },
  "//:schedule-site-deploy": { schedule: "2,12,22,32,42,52 * * * *", run: "//:site-deploy" },
  "//:schedule-migrate-eval": { schedule: "5,15,25,35,45,55 * * * *", run: "//:migrate-eval" },
  "//:schedule-nightly-fuzz": { schedule: "20 1 * * *", run: "//:nightly-fuzz" }
};

test("all four schedules are declared as S.Cron targets with refresh and manual/exclusive run targets (#476)", async () => {
  const index = await openPackageIndex({ workspace: repo });
  const labelOf = (target) => index.labelsByTarget.get(target);
  const cronLabels = [];

  for (const [label, entry] of index.byLabel.entries()) {
    const target = entry?.target ?? entry;
    const meta = Target.metadata(target);
    if (meta.target !== "Cron") continue;
    cronLabels.push(label);
    const attrs = CronTarget.attrsOf(target);
    assert.ok(EXPECTED[label], `unexpected Cron target ${label}`);
    assert.equal(attrs.schedule, EXPECTED[label].schedule, `${label} schedule`);
    assert.equal(attrs.schedule.trim().split(/\s+/).length, 5, `${label} 5-field cron`);

    assert.ok(Array.isArray(attrs.refresh) && attrs.refresh.length === 1, `${label} declares refresh`);
    assert.equal(labelOf(attrs.refresh[0]), "//:schedule-refresh", `${label} refreshes via //:schedule-refresh`);

    assert.equal(attrs.run.length, 1, `${label} runs one target`);
    const runTarget = attrs.run[0];
    assert.equal(labelOf(runTarget), EXPECTED[label].run, `${label} runs ${EXPECTED[label].run}`);
    const runMeta = Target.metadata(runTarget);
    const isManualOrExclusive = Boolean(runMeta.attrs?.manual || runMeta.attrs?.exclusive);
    assert.equal(isManualOrExclusive, true, `${EXPECTED[label].run} must be manual or exclusive so ci //... skips it`);
  }

  assert.deepEqual(cronLabels.sort(), Object.keys(EXPECTED).sort());
});

test("smthrs targets lists all four declared Cron schedules cleanly", () => {
  const smthrs = path.join(repo, ".smithers/node_modules/.bin/smthrs");
  const res = spawnSync(process.execPath, [smthrs, "targets", "//...", "--workspace", repo, "--format", "json"], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const parsed = JSON.parse(res.stdout);
  const crons = (parsed.targets ?? [])
    .filter((row) => row.target === "Cron")
    .map((row) => row.label)
    .sort();
  assert.deepEqual(crons, [
    "//:schedule-coverage-census",
    "//:schedule-migrate-eval",
    "//:schedule-nightly-fuzz",
    "//:schedule-site-deploy"
  ]);
});
