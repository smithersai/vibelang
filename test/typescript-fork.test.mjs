import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../typescript-fork.json", import.meta.url), "utf8"),
);

test("TypeScript fork manifest pins the smithersai fork", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(
    manifest.repository,
    "https://github.com/smithersai/TypeScript.git",
  );
  assert.equal(
    manifest.upstreamRepository,
    "https://github.com/microsoft/TypeScript.git",
  );
  assert.equal(manifest.vendorPath, "vendor/typescript");
  assert.equal(manifest.strategy, "git-subtree-squash");
  assert.match(manifest.revision, /^[0-9a-f]{40}$/);
  assert.match(manifest.upstreamBaseline, /^[0-9a-f]{40}$/);
});

test("TypeScript fork capsule status is machine-readable", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/vendor-typescript.mjs", "status"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.revision, manifest.revision);
  assert.equal(status.present, true);
  assert.equal(status.format, "git-bundle+file-go-proxy");
  assert.equal(status.requestedLedgerStrategy, manifest.strategy);
  assert.equal(Number.isInteger(status.dependencyModules), true);
  assert.equal(Number.isInteger(status.payloadFiles), true);
  assert.equal(Number.isInteger(status.payloadBytes), true);
  assert.deepEqual(status.errors, []);
  assert.equal(typeof status.synchronized, "boolean");
});
