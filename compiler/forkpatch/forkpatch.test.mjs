// Tests for the fork patch-carrying mechanism.
//
//   node --test compiler/forkpatch/forkpatch.test.mjs
//
// The series-integrity tests always run and need nothing but this repository.
// The checkout-backed tests need a prepared pinned checkout and are skipped
// without one:
//
//   node scripts/prepare-typescript-fork.mjs --cache /tmp/forkpatch-cache --full-tsc
//   SMITHERS_FORKPATCH_TEST_CHECKOUT=/tmp/forkpatch-cache/<revision> \
//     node --test compiler/forkpatch/forkpatch.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const driver = resolve(here, "forkpatch.mjs");
const series = JSON.parse(readFileSync(resolve(here, "series.json"), "utf8"));
const manifest = JSON.parse(
  readFileSync(resolve(root, "typescript-fork.json"), "utf8"),
);
const checkout = process.env.SMITHERS_FORKPATCH_TEST_CHECKOUT;

function forkpatch(...args) {
  const completed = spawnSync(process.execPath, [driver, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: completed.status,
    stdout: completed.stdout ?? "",
    stderr: completed.stderr ?? "",
    json: () => JSON.parse(completed.stdout),
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("series integrity", () => {
  it("pins the same upstream revision as typescript-fork.json", () => {
    assert.equal(series.schemaVersion, 1);
    assert.equal(series.revision, manifest.revision);
  });

  it("records a digest for every patch file, and every patch file is recorded", () => {
    const onDisk = readdirSync(resolve(here, "patches"))
      .filter((name) => name.endsWith(".patch"))
      .sort();
    const recorded = series.patches.map((patch) => patch.file.slice("patches/".length));
    assert.deepEqual(recorded, [...recorded].sort(), "patches must be listed in apply order");
    assert.deepEqual([...recorded].sort(), onDisk);
    for (const patch of series.patches) {
      assert.equal(sha256(resolve(here, patch.file)), patch.sha256, patch.file);
      assert.ok(["handwritten", "generated", "forkowned"].includes(patch.kind), patch.kind);
      assert.ok(patch.summary.length > 0);
    }
  });

  it("only touches paths inside the fork's three top-level directories", () => {
    const paths = [...Object.keys(series.preImage), ...series.created];
    assert.ok(paths.length > 0);
    for (const path of paths) {
      assert.match(path, /^(tsc|tools|packages)\//u, path);
      assert.ok(!path.split("/").includes(".."), path);
    }
  });

  it("keeps created files out of the pre-image and inside the post-image", () => {
    for (const path of series.created) {
      assert.ok(!(path in series.preImage), `${path} must not have a pre-image`);
      assert.ok(path in series.postImage, `${path} must have a post-image`);
    }
    const modified = Object.keys(series.preImage);
    assert.deepEqual(
      Object.keys(series.postImage).sort(),
      [...modified, ...series.created].sort(),
    );
  });

  it("changes every file it records a pre-image for", () => {
    for (const [path, digest] of Object.entries(series.preImage)) {
      assert.notEqual(series.postImage[path], digest, `${path} is recorded but unchanged`);
    }
  });

  it("declares which files are generated, and they are all in the post-image", () => {
    assert.ok(series.generated.length > 0);
    for (const path of series.generated) {
      assert.ok(path in series.postImage, path);
      assert.match(path, /_generated\.(go|ts)$|\.generated\.ts$/u, path);
    }
  });

  it("separates hand-written from generated patches", () => {
    const kinds = new Set(series.patches.map((patch) => patch.kind));
    assert.ok(kinds.has("handwritten"), "a reviewer needs a hand-written patch to read");
    assert.ok(kinds.has("generated"), "generated output must be carried separately");
  });
});

describe("argument and gate handling", () => {
  it("requires a command", () => {
    const result = forkpatch("--checkout", root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /a command is required/u);
  });

  it("requires --checkout", () => {
    const result = forkpatch("status");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--checkout is required/u);
  });

  it("rejects an unknown argument", () => {
    const result = forkpatch("status", "--checkout", root, "--wat");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown argument/u);
  });

  it("rejects a directory that is not a fork checkout", () => {
    const result = forkpatch("status", "--checkout", root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not look like a TypeScript fork checkout/u);
  });

  it("rejects a checkout at the wrong revision", () => {
    const fake = mkdtempSync(resolve(tmpdir(), "forkpatch-wrong-revision-"));
    try {
      const git = (...args) =>
        spawnSync("git", ["-C", fake, ...args], { encoding: "utf8" });
      spawnSync("git", ["init", "--quiet", fake]);
      git("config", "user.email", "test@example.com");
      git("config", "user.name", "test");
      spawnSync("mkdir", ["-p", resolve(fake, "tsc")]);
      writeFileSync(
        resolve(fake, "tsc/go.mod"),
        "module github.com/microsoft/TypeScript/tsc\n",
      );
      git("add", "-A");
      git("commit", "-qm", "not the pinned revision");

      const result = forkpatch("apply", "--checkout", fake);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`require ${manifest.revision}`, "u"));
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe("checkout round trip", { skip: checkout ? false : "no prepared checkout" }, () => {
  const firstModified = Object.keys(series.preImage)[0];
  const firstModifiedPath = resolve(checkout ?? ".", firstModified ?? "x");

  // The supplied checkout may already carry the series. Reversing it with the
  // tool's own `unapply` is the only normalization allowed: a "mixed" checkout
  // is left alone so the first assertion reports it.
  before(() => {
    if (!checkout) return;
    const state = forkpatch("status", "--checkout", checkout);
    if (state.status === 0 && state.json().state === "applied") {
      forkpatch("unapply", "--checkout", checkout);
    }
  });

  after(() => {
    if (!checkout) return;
    const state = forkpatch("status", "--checkout", checkout);
    if (state.status === 0 && state.json().state === "applied") {
      forkpatch("unapply", "--checkout", checkout);
    }
    spawnSync("git", ["-C", checkout, "checkout", "--", "."]);
    for (const path of series.created) {
      const full = resolve(checkout, path);
      if (existsSync(full)) rmSync(full);
    }
  });

  it("starts pristine", () => {
    const result = forkpatch("status", "--checkout", checkout);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json().state, "pristine");
  });

  it("applies, reaches the recorded post-image, and refuses a second apply", () => {
    const applied = forkpatch("apply", "--checkout", checkout);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(applied.json().state, "applied");
    assert.equal(applied.json().applied.length, series.patches.length);

    for (const [path, digest] of Object.entries(series.postImage)) {
      assert.equal(sha256(resolve(checkout, path)), digest, path);
    }

    const again = forkpatch("apply", "--checkout", checkout);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already applied/u);
  });

  it("verifies an applied checkout", () => {
    const result = forkpatch("verify", "--checkout", checkout);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.json().postImageFilesVerified,
      Object.keys(series.postImage).length,
    );
  });

  it("fails closed on a locally modified file", () => {
    const original = readFileSync(firstModifiedPath);
    try {
      writeFileSync(firstModifiedPath, `${original.toString()}\n// local edit\n`);
      const state = forkpatch("status", "--checkout", checkout);
      assert.equal(state.json().state, "mixed");
      const applied = forkpatch("apply", "--checkout", checkout);
      assert.equal(applied.status, 1);
      assert.match(applied.stderr, /neither pristine nor fully patched/u);
      const unapplied = forkpatch("unapply", "--checkout", checkout);
      assert.equal(unapplied.status, 1);
      assert.match(unapplied.stderr, /neither pristine nor fully patched/u);
    } finally {
      writeFileSync(firstModifiedPath, original);
    }
  });

  it("unapplies back to a byte-identical pristine tree", () => {
    const result = forkpatch("unapply", "--checkout", checkout);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json().state, "pristine");

    for (const [path, digest] of Object.entries(series.preImage)) {
      assert.equal(sha256(resolve(checkout, path)), digest, path);
    }
    for (const path of series.created) {
      assert.ok(!existsSync(resolve(checkout, path)), `${path} must be removed`);
    }

    const status = spawnSync(
      "git",
      ["-C", checkout, "status", "--porcelain=v1", "--untracked-files=all"],
      { encoding: "utf8" },
    );
    assert.equal(status.stdout.trim(), "", "git must see no residue after unapply");
  });

  it("refuses to unapply a pristine checkout", () => {
    const result = forkpatch("unapply", "--checkout", checkout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not applied/u);
  });

  it("refuses to verify a pristine checkout", () => {
    const result = forkpatch("verify", "--checkout", checkout);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run `apply` first/u);
  });
});
