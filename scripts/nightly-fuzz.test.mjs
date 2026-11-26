import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = new URL("./nightly-fuzz.sh", import.meta.url).pathname;

function makeFixture(t, targets) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nightly-fuzz-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "state");
  const goStub = path.join(dir, "go-stub.sh");
  const campaignStub = path.join(dir, "campaign-stub.sh");
  const invocations = path.join(dir, "invocations.log");

  writeFileSync(goStub, `#!/bin/sh\nprintf '%s\\n' ${targets.map((n) => JSON.stringify(n)).join(" ")}\n`);
  chmodSync(goStub, 0o755);

  writeFileSync(campaignStub, `#!/bin/sh\necho "$*" >> ${JSON.stringify(invocations)}\n`);
  chmodSync(campaignStub, 0o755);

  const run = (extraEnv = {}) =>
    spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...process.env,
        NIGHTLY_ROOT: root,
        NIGHTLY_GO: goStub,
        NIGHTLY_CAMPAIGN: campaignStub,
        NIGHTLY_MIN_FREE_GB: "0",
        NIGHTLY_TARGET_TIME: "5m",
        NIGHTLY_TARGETS: "3",
        ...extraEnv
      }
    });

  const readInvocations = () =>
    readFileSync(invocations, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" ").slice(1));

  return { dir, root, run, readInvocations };
}

test("rotates through targets in bounded slices and wraps cleanly", (t) => {
  const targets = ["FuzzA", "FuzzB", "FuzzC", "FuzzD", "FuzzE"];
  const f = makeFixture(t, targets);

  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);
  assert.equal(f.run().status, 0);

  const slices = f.readInvocations();
  assert.deepEqual(slices, [
    ["FuzzA", "FuzzB", "FuzzC"],
    ["FuzzD", "FuzzE", "FuzzA"],
    ["FuzzB", "FuzzC", "FuzzD"]
  ]);
  assert.equal(readFileSync(path.join(f.root, "cursor"), "utf8").trim(), "4");
});

test("covers every target across ceil(N / slice) consecutive nights", (t) => {
  const targets = Array.from({ length: 10 }, (_, i) => `FuzzTarget${String(i).padStart(2, "0")}`);
  const f = makeFixture(t, targets);

  for (let night = 0; night < 4; night++) {
    const res = f.run({ NIGHTLY_TARGETS: "3" });
    assert.equal(res.status, 0, res.stderr);
  }
  const seen = new Set(f.readInvocations().flat());
  assert.deepEqual([...seen].sort(), targets);
});

test("skips cleanly when another run holds the lock", (t) => {
  const f = makeFixture(t, ["FuzzA", "FuzzB"]);
  mkdirSync(path.join(f.root, "lock.d"), { recursive: true });
  const res = f.run();
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /another run holds/);
});
