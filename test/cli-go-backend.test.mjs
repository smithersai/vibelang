import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const forkManifest = JSON.parse(readFileSync(join(repositoryRoot, "typescript-fork.json"), "utf8"));
const forkSeries = JSON.parse(readFileSync(join(repositoryRoot, "compiler/forkpatch/series.json"), "utf8"));

function runSmithers(args, env = {}) {
  return spawnSync(process.execPath, ["bin/smithers.js", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 360_000,
    maxBuffer: 128 * 1024 * 1024,
  });
}

function locateForkCheckout() {
  const configured = process.env.SMITHERS_TYPESCRIPT_FORK;
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;
  const cacheRoots = process.env.SMITHERS_TYPESCRIPT_FORK_CACHE
    ? [resolve(process.env.SMITHERS_TYPESCRIPT_FORK_CACHE)]
    : ["/private/tmp/smithers-ts-fork-cache", join(tmpdir(), "smithers-ts-fork-cache")];
  return cacheRoots
    .map((cache) => join(cache, forkManifest.revision))
    .find((checkout) => existsSync(join(checkout, "go.work")));
}

const forkCheckout = locateForkCheckout();
const missingForkMessage =
  "Go backend checkout unavailable; prepare and patch it to run the experimental backend integration case";

function parsedPureJson(result) {
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^\s*\{/);
  return JSON.parse(result.stdout);
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

function makePristineCheckout(t, sourceCheckout) {
  const root = mkdtempSync(join(tmpdir(), "smithers-cli-pristine-fork-"));
  const checkout = join(root, "typescript");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runGit(["clone", "--quiet", "--shared", "--no-checkout", sourceCheckout, checkout]);
  runGit(["-C", checkout, "sparse-checkout", "init", "--no-cone"]);
  const paths = new Set([
    "tsc/go.mod",
    ...Object.keys(forkSeries.preImage),
  ]);
  runGit(
    ["-C", checkout, "sparse-checkout", "set", "--no-cone", "--stdin"],
    { input: `${[...paths].map((path) => `/${path}`).join("\n")}\n` },
  );
  runGit(["-C", checkout, "checkout", "--quiet", "--detach", forkManifest.revision]);
  return checkout;
}

test("--backend go fails closed with an actionable code when the checkout is absent", () => {
  const absent = join(tmpdir(), `smithers-c19-absent-${process.pid}`);
  assert.equal(existsSync(absent), false);
  const result = runSmithers([
    "check",
    "test/fixtures/basic.sm",
    "--backend",
    "go",
    "--format",
    "json",
  ], { SMITHERS_TYPESCRIPT_FORK: absent });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = parsedPureJson(result);
  assert.equal(report.code, "SMITHERS_GO_CHECKOUT_MISSING");
  assert.match(report.message, /node scripts\/prepare-typescript-fork\.mjs --fetch --cache/);
  assert.match(report.message, /node compiler\/forkpatch\/forkpatch\.mjs apply --checkout/);
  assert.doesNotMatch(report.message, /fallback/i);
});

test("JS and Go run backends execute identical Result lifting and postfix propagation", {
  skip: forkCheckout ? false : missingForkMessage,
}, (t) => {
  const project = mkdtempSync(join(tmpdir(), "smithers-cli-backend-parity-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const source = join(project, "main.sm");
  writeFileSync(source, [
    "declare const process: { stdout: { write(value: string): boolean } }",
    "class InvalidScore extends Error {}",
    "function score(value: number): Result<number, InvalidScore> {",
    "  if (value < 0) throw new InvalidScore(\"negative\")",
    "  return value + 1",
    "}",
    "function doubled(value: number): Result<number, InvalidScore> {",
    "  const checked = score(value)!",
    "  return checked * 2",
    "}",
    "process.stdout.write(doubled(2).match({ ok: (value) => `ok:${value}\\n`, error: (error) => `error:${error.message}\\n` }))",
    "process.stdout.write(doubled(-1).match({ ok: (value) => `ok:${value}\\n`, error: (error) => `error:${error.message}\\n` }))",
    "",
  ].join("\n"));

  const reports = new Map();
  for (const backend of ["js", "go"]) {
    const result = runSmithers(["run", source, "--backend", backend, "--format", "json"], {
      SMITHERS_TYPESCRIPT_FORK: forkCheckout,
    });
    assert.equal(result.status, 0, `${backend}: ${result.stderr || result.stdout}`);
    const report = parsedPureJson(result);
    assert.equal(report.output, "ok:6\nerror:negative\n");
    assert.equal(report.errorOutput, "");
    reports.set(backend, report);
  }
  assert.deepEqual(reports.get("go"), reports.get("js"));

  const defaultResult = runSmithers(["run", source, "--format", "json"]);
  assert.equal(defaultResult.status, 0, defaultResult.stderr || defaultResult.stdout);
  assert.deepEqual(parsedPureJson(defaultResult), reports.get("js"));
});

test("both backend JSON reports keep authored diagnostic positions and one report shape", {
  skip: forkCheckout ? false : missingForkMessage,
}, (t) => {
  const project = mkdtempSync(join(tmpdir(), "smithers-cli-backend-diagnostic-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const source = join(project, "invalid.sm");
  writeFileSync(source, [
    "class BadValue extends Error {}",
    "function invalid(): Result<number, BadValue> {",
    "  return \"wrong\"",
    "}",
    "",
  ].join("\n"));
  const canonicalSource = realpathSync(source);

  for (const backend of ["js", "go"]) {
    const result = runSmithers(["check", source, "--backend", backend, "--format", "json"], {
      SMITHERS_TYPESCRIPT_FORK: forkCheckout,
    });
    assert.equal(result.status, 1, `${backend}: ${result.stderr || result.stdout}`);
    const report = parsedPureJson(result);
    assert.deepEqual(Object.keys(report).sort(), ["files", "ok"]);
    assert.equal(report.ok, false);
    assert.equal(report.files[0].input, canonicalSource);
    assert.equal(Array.isArray(report.files[0].diagnostics), true);
    assert.equal(typeof report.files[0].rows, "object");
    const authored = report.files[0].diagnostics.find((diagnostic) =>
      diagnostic.file === canonicalSource && diagnostic.line !== undefined && diagnostic.column !== undefined);
    assert.ok(authored, `${backend} did not report an authored position: ${result.stdout}`);
    assert.equal(authored.line, 3);
    assert.ok(authored.column >= 3);
  }
});

test("--backend go rejects a pristine unpatched checkout with the exact apply remedy", {
  skip: forkCheckout ? false : missingForkMessage,
}, (t) => {
  const pristine = makePristineCheckout(t, forkCheckout);
  const status = spawnSync(process.execPath, [
    "compiler/forkpatch/forkpatch.mjs",
    "status",
    "--checkout",
    pristine,
  ], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(status.status, 0, status.stderr || status.stdout);
  assert.equal(JSON.parse(status.stdout).state, "pristine");

  const result = runSmithers([
    "check",
    "test/fixtures/basic.sm",
    "--backend",
    "go",
    "--format",
    "json",
  ], { SMITHERS_TYPESCRIPT_FORK: pristine });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = parsedPureJson(result);
  assert.equal(report.code, "SMITHERS_GO_CHECKOUT_UNPATCHED");
  assert.equal(
    report.message,
    `The pinned TypeScript fork checkout is pristine but unpatched. Remedy: run ` +
      `\`node compiler/forkpatch/forkpatch.mjs apply --checkout '${pristine}'\`.`,
  );
});
