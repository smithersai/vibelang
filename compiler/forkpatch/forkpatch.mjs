#!/usr/bin/env node

// forkpatch carries Smithers's *modifications* to pinned upstream TypeScript
// files. The repository already has two mechanisms for *additive* fork sources —
// `go build -overlay` (compiler/fork.go) and controlled checkout population
// (scripts/build-smithersc.mjs) — and neither can express a change to a file that
// upstream also owns, nor to `tools/scripts/tsc/ast.json`, which is not Go at
// all. See README.md for the mechanism contract and the rejected alternatives.
//
// Every command is offline and needs nothing but git. Only `record` and
// `verify --regenerate` need Node >= 22.6 and dprint, and both are
// authoring-time commands.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const seriesPath = resolve(here, "series.json");
const patchDirectory = resolve(here, "patches");
const manifestPath = resolve(root, "typescript-fork.json");

function fail(message) {
  console.error(`forkpatch: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 256 * 1024 * 1024,
    stdio: "pipe",
  });
  if (completed.error) fail(completed.error.message);
  if (!options.tolerateFailure && completed.status !== 0) {
    const detail =
      completed.stderr?.trim() || completed.stdout?.trim() || "no output";
    fail(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return completed;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readManifestRevision() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!/^[0-9a-f]{40}$/u.test(manifest.revision ?? "")) {
    fail("typescript-fork.json has no valid revision");
  }
  return manifest.revision;
}

// ---------------------------------------------------------------------------
// series.json
// ---------------------------------------------------------------------------

function readSeries({ tolerateMissing = false } = {}) {
  if (!existsSync(seriesPath)) {
    if (tolerateMissing) return undefined;
    fail("compiler/forkpatch/series.json is absent");
  }
  const series = JSON.parse(readFileSync(seriesPath, "utf8"));
  if (series.schemaVersion !== 1) fail("series.json schemaVersion must be 1");
  const revision = readManifestRevision();
  if (series.revision !== revision) {
    fail(
      `series.json records upstream ${series.revision} but typescript-fork.json pins ${revision}; ` +
        "re-record the series against the new revision before applying it",
    );
  }
  if (!Array.isArray(series.patches) || series.patches.length === 0) {
    fail("series.json lists no patches");
  }
  const seen = new Set();
  for (const patch of series.patches) {
    if (typeof patch.file !== "string" || !patch.file.startsWith("patches/")) {
      fail(`series.json patch entry has an invalid file: ${patch.file}`);
    }
    if (patch.file.split(/[\\/]/u).includes("..")) {
      fail(`series.json patch entry escapes the patch directory: ${patch.file}`);
    }
    if (seen.has(patch.file)) fail(`series.json lists ${patch.file} twice`);
    seen.add(patch.file);
    const path = resolve(here, patch.file);
    if (!existsSync(path)) fail(`patch file is absent: ${patch.file}`);
    if (sha256(path) !== patch.sha256) {
      fail(`patch file digest mismatch: ${patch.file}`);
    }
  }
  const recorded = new Set(series.patches.map((patch) => patch.file));
  for (const name of readdirSync(patchDirectory).sort()) {
    if (!name.endsWith(".patch")) continue;
    if (!recorded.has(`patches/${name}`)) {
      fail(`patches/${name} exists but is not listed in series.json`);
    }
  }
  return series;
}

function patchPaths(series) {
  return series.patches.map((patch) => resolve(here, patch.file));
}

// ---------------------------------------------------------------------------
// Checkout gates
// ---------------------------------------------------------------------------

function checkoutRevision(checkout) {
  if (!existsSync(resolve(checkout, "tsc/go.mod"))) {
    fail(`${checkout} does not look like a TypeScript fork checkout`);
  }
  return run("git", ["-C", checkout, "rev-parse", "HEAD"]).stdout.trim();
}

function requirePinnedCheckout(checkout) {
  const revision = readManifestRevision();
  const actual = checkoutRevision(checkout);
  if (actual !== revision) {
    fail(`checkout ${checkout} is ${actual}; require ${revision}`);
  }
}

// A path the series touches must be materialized. A sparse checkout that omits
// `tools/` or `packages/` would otherwise make `git apply` fail with a message
// about the patch rather than about the checkout.
function requireMaterialized(checkout, paths) {
  const missing = paths.filter((path) => !existsSync(resolve(checkout, path)));
  if (missing.length > 0) {
    fail(
      `checkout ${checkout} does not materialize ${missing.length} file(s) the series needs, ` +
        `starting with ${missing[0]}. Prepare it with scripts/prepare-typescript-fork.mjs, ` +
        "which includes tools/ and packages/ in both sparse-checkout paths.",
    );
  }
}

/**
 * Classify a checkout against the recorded digests.
 *
 * "pristine" — every pre-image digest matches and no created file exists.
 * "applied"  — every post-image digest matches and every created file exists.
 * "mixed"    — anything else. Always a hard failure: a partially applied or
 *              locally edited tree must never be silently patched over.
 */
function classify(checkout, series) {
  const problems = { pristine: [], applied: [] };
  for (const [path, digest] of Object.entries(series.preImage)) {
    const full = resolve(checkout, path);
    if (!existsSync(full) || sha256(full) !== digest) problems.pristine.push(path);
  }
  for (const path of series.created) {
    if (existsSync(resolve(checkout, path))) problems.pristine.push(path);
  }
  for (const [path, digest] of Object.entries(series.postImage)) {
    const full = resolve(checkout, path);
    if (!existsSync(full) || sha256(full) !== digest) problems.applied.push(path);
  }
  if (problems.pristine.length === 0) return { state: "pristine", problems };
  if (problems.applied.length === 0) return { state: "applied", problems };
  return { state: "mixed", problems };
}

function describeMixed(problems) {
  const sample = (list) => list.slice(0, 5).map((path) => `      ${path}`).join("\n");
  return (
    "the checkout is neither pristine nor fully patched.\n" +
    `    ${problems.pristine.length} file(s) differ from the pinned upstream content:\n` +
    `${sample(problems.pristine)}\n` +
    `    ${problems.applied.length} file(s) differ from the fully patched content:\n` +
    `${sample(problems.applied)}\n` +
    "    Re-materialize the checkout with scripts/prepare-typescript-fork.mjs and apply again."
  );
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function applySeries(checkout, series, { reverse = false } = {}) {
  const files = patchPaths(series);
  const ordered = reverse ? [...files].reverse() : files;
  for (const file of ordered) {
    const args = ["-C", checkout, "apply", "--whitespace=nowarn"];
    if (reverse) args.push("--reverse");
    // --check first so a bad patch never leaves a half-applied tree.
    run("git", [...args, "--check", file]);
    run("git", [...args, file]);
  }
  return ordered.map((file) => relative(here, file).split(sep).join("/"));
}

function commandStatus(checkout) {
  const series = readSeries();
  requirePinnedCheckout(checkout);
  const { state, problems } = classify(checkout, series);
  return {
    command: "status",
    checkout,
    revision: series.revision,
    state,
    patches: series.patches.length,
    modified: Object.keys(series.preImage).length,
    created: series.created.length,
    divergentFromPristine: state === "pristine" ? 0 : problems.pristine.length,
    divergentFromApplied: state === "applied" ? 0 : problems.applied.length,
  };
}

function commandApply(checkout) {
  const series = readSeries();
  requirePinnedCheckout(checkout);
  requireMaterialized(checkout, Object.keys(series.preImage));
  const before = classify(checkout, series);
  if (before.state === "applied") {
    fail("the series is already applied to this checkout");
  }
  if (before.state === "mixed") fail(describeMixed(before.problems));
  const applied = applySeries(checkout, series);
  const after = classify(checkout, series);
  if (after.state !== "applied") {
    fail(
      "the series applied but the result does not match the recorded post-image; " +
        `first divergent file: ${after.problems.applied[0]}`,
    );
  }
  return {
    command: "apply",
    checkout,
    revision: series.revision,
    applied,
    modified: Object.keys(series.postImage).length - series.created.length,
    created: series.created.length,
    state: "applied",
  };
}

function commandUnapply(checkout) {
  const series = readSeries();
  requirePinnedCheckout(checkout);
  const before = classify(checkout, series);
  if (before.state === "pristine") fail("the series is not applied to this checkout");
  if (before.state === "mixed") fail(describeMixed(before.problems));
  applySeries(checkout, series, { reverse: true });
  for (const path of series.created) {
    const full = resolve(checkout, path);
    if (existsSync(full)) rmSync(full);
  }
  const after = classify(checkout, series);
  if (after.state !== "pristine") {
    fail(
      "the series reversed but the checkout is not pristine again; " +
        `first divergent file: ${after.problems.pristine[0]}`,
    );
  }
  return {
    command: "unapply",
    checkout,
    revision: series.revision,
    state: "pristine",
  };
}

function regenerate(checkout, series) {
  const node = process.env.SMITHERS_FORKPATCH_NODE ?? "node";
  const version = run(node, ["--version"]).stdout.trim();
  const [major, minor] = version.replace(/^v/u, "").split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 6)) {
    fail(
      `${node} is ${version}; the AST generator needs >= v22.6 for --experimental-strip-types ` +
        "(set SMITHERS_FORKPATCH_NODE to a newer Node)",
    );
  }
  run(node, [
    "--experimental-strip-types",
    "--no-warnings",
    "./tools/scripts/tsc/generate.ts",
  ], { cwd: checkout });

  const go = process.env.SMITHERS_GO ?? "go";
  run(go, [
    "tool",
    "golang.org/x/tools/cmd/stringer",
    "-type=Kind",
    "-output=kind_stringer_generated.go",
    ".",
  ], {
    cwd: resolve(checkout, "tsc/internal/ast"),
    env: { ...process.env, GOTOOLCHAIN: "local", GOFLAGS: "-buildvcs=false" },
  });
  run(series.generator.formatterCommand ?? "dprint", [
    "fmt",
    "tsc/internal/ast/kind_stringer_generated.go",
  ], { cwd: checkout });
}

function commandVerify(checkout, options) {
  const series = readSeries();
  requirePinnedCheckout(checkout);
  const state = classify(checkout, series);
  if (state.state !== "applied") {
    fail(
      state.state === "pristine"
        ? "the series is not applied to this checkout; run `apply` first"
        : describeMixed(state.problems),
    );
  }
  let regenerated;
  if (options.regenerate) {
    regenerate(checkout, series);
    const after = classify(checkout, series);
    if (after.state !== "applied") {
      fail(
        "regeneration changed the tree: the checked-in generated patch is NOT what the " +
          `generator produces. First divergent file: ${after.problems.applied[0]}`,
      );
    }
    regenerated = series.generated;
  }
  return {
    command: "verify",
    checkout,
    revision: series.revision,
    state: "applied",
    postImageFilesVerified: Object.keys(series.postImage).length,
    regenerated,
  };
}

// Authoring-time: apply the series to a pristine checkout, capturing the exact
// digests before and after, and write series.json. Recording is itself the
// end-to-end proof that the series applies to the pinned revision and produces
// one determinate tree.
function commandRecord(checkout) {
  const revision = readManifestRevision();
  requirePinnedCheckout(checkout);
  const status = run("git", [
    "-C",
    checkout,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).stdout.trim();
  if (status !== "") fail(`checkout ${checkout} is dirty:\n${status}`);

  const names = readdirSync(patchDirectory)
    .filter((name) => name.endsWith(".patch"))
    .sort();
  if (names.length === 0) fail("compiler/forkpatch/patches is empty");

  // Which files does the series touch, and which does it create?
  const touched = new Set();
  const created = new Set();
  for (const name of names) {
    const text = readFileSync(join(patchDirectory, name), "utf8");
    let pendingNew = false;
    for (const line of text.split("\n")) {
      const header = /^diff --git a\/(.+?) b\/(.+)$/u.exec(line);
      if (header) {
        touched.add(header[2]);
        pendingNew = false;
        continue;
      }
      if (line.startsWith("new file mode")) pendingNew = true;
      if (pendingNew && line.startsWith("+++ b/")) {
        created.add(line.slice("+++ b/".length));
        pendingNew = false;
      }
    }
  }
  const modified = [...touched].filter((path) => !created.has(path)).sort();
  requireMaterialized(checkout, modified);

  const preImage = {};
  for (const path of modified) preImage[path] = sha256(resolve(checkout, path));
  for (const path of created) {
    if (existsSync(resolve(checkout, path))) {
      fail(`the series creates ${path} but the pristine checkout already has it`);
    }
  }

  for (const name of names) {
    const file = join(patchDirectory, name);
    run("git", ["-C", checkout, "apply", "--whitespace=nowarn", "--check", file]);
    run("git", ["-C", checkout, "apply", "--whitespace=nowarn", file]);
  }

  const postImage = {};
  for (const path of [...modified, ...[...created].sort()]) {
    const full = resolve(checkout, path);
    if (!existsSync(full)) fail(`the series did not produce ${path}`);
    postImage[path] = sha256(full);
  }

  const summariesPath = resolve(here, "summaries.json");
  if (!existsSync(summariesPath)) {
    fail("compiler/forkpatch/summaries.json is absent; describe each patch there first");
  }
  const summaries = JSON.parse(readFileSync(summariesPath, "utf8"));
  const undescribed = names.filter((name) => summaries[name] === undefined);
  if (undescribed.length > 0) {
    fail(`summaries.json does not describe: ${undescribed.join(", ")}`);
  }
  const series = {
    schemaVersion: 1,
    revision,
    generator: {
      ast: "node --experimental-strip-types --no-warnings ./tools/scripts/tsc/generate.ts",
      stringer:
        "go tool golang.org/x/tools/cmd/stringer -type=Kind -output=kind_stringer_generated.go ./tsc/internal/ast",
      formatterCommand: "dprint",
      formatter: "dprint@0.55.1 (the version .dprint.jsonc pins)",
      nodeMinimum: "22.6.0",
    },
    patches: names.map((name) => ({
      file: `patches/${name}`,
      sha256: sha256(join(patchDirectory, name)),
      kind: summaries[name]?.kind ?? "handwritten",
      summary: summaries[name]?.summary ?? name,
    })),
    generated: Object.keys(postImage).filter((path) =>
      /_generated\.(go|ts)$|\.generated\.ts$/u.test(path),
    ),
    created: [...created].sort(),
    preImage,
    postImage,
  };
  mkdirSync(dirname(seriesPath), { recursive: true });
  writeFileSync(seriesPath, `${JSON.stringify(series, null, 2)}\n`);

  return {
    command: "record",
    checkout,
    revision,
    patches: series.patches.length,
    modified: modified.length,
    created: series.created.length,
    generated: series.generated.length,
    series: relative(root, seriesPath).split(sep).join("/"),
  };
}

// ---------------------------------------------------------------------------

function parseArguments(argv) {
  const commands = new Set(["status", "apply", "unapply", "verify", "record"]);
  const result = { command: undefined, checkout: undefined, regenerate: false };
  if (commands.has(argv[0])) result.command = argv.shift();
  while (argv.length > 0) {
    const argument = argv.shift();
    switch (argument) {
      case "--checkout":
        result.checkout = resolve(argv.shift() ?? fail("--checkout needs a path"));
        break;
      case "--regenerate":
        result.regenerate = true;
        break;
      case "--help":
        process.stdout.write(
          "usage: forkpatch.mjs <status|apply|unapply|verify|record> --checkout PATH [--regenerate]\n" +
            "\n" +
            "  status    classify a checkout as pristine, applied, or mixed\n" +
            "  apply     apply the series to a pristine checkout and verify the post-image\n" +
            "  unapply   reverse the series and verify the checkout is pristine again\n" +
            "  verify    confirm an applied checkout matches the recorded post-image;\n" +
            "            --regenerate additionally re-runs the AST generator and requires\n" +
            "            the checked-in generated bytes to be exactly what it produces\n" +
            "  record    (authoring) apply patches/ to a pristine checkout and write series.json\n" +
            "\napply, unapply, and status are offline and need only git.\n",
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  if (result.command === undefined) fail("a command is required; see --help");
  if (result.checkout === undefined) fail("--checkout is required");
  if (!existsSync(result.checkout)) fail(`no such checkout: ${result.checkout}`);
  return result;
}

const args = parseArguments(process.argv.slice(2));
const output = {
  status: () => commandStatus(args.checkout),
  apply: () => commandApply(args.checkout),
  unapply: () => commandUnapply(args.checkout),
  verify: () => commandVerify(args.checkout, args),
  record: () => commandRecord(args.checkout),
}[args.command]();
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
