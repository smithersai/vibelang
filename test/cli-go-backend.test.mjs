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
    // Rows are the one observation the two backends cannot be compared on, so
    // the report must say which of the two claims it is making. "Unknown" and
    // "none" were the same bytes until F7: the Go path hardcoded `rows: {}`,
    // which reads as the positive claim that the file requires nothing.
    if (backend === "js") {
      assert.equal(typeof report.files[0].rows, "object");
      assert.equal(report.files[0].rowsUnavailable, undefined, "a backend that reports rows must not also claim they are unavailable");
    } else {
      assert.equal(
        report.files[0].rows,
        undefined,
        "the Go backend has no rows channel, so it must not present an empty row set as an answer",
      );
      assert.match(report.files[0].rowsUnavailable, /go backend does not report requirement rows/);
      assert.match(report.files[0].rowsUnavailable, /--backend js/);
    }
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

/**
 * A Go diagnostic is attributed by the name the request actually sent.
 *
 * The CLI used to group Go diagnostics with
 * `diagnostics.get(diagnostic.file) ?? diagnostics.values().next().value`, so a
 * diagnostic naming a file the request never contained landed on the *first*
 * source with a position computed from a different file's text. Pointing a
 * reader at the wrong file is worse than pointing them nowhere, and it is
 * indistinguishable in the report from a real diagnostic in that file.
 *
 * `resolveGoDiagnosticFile` is unit-tested here rather than driven through the
 * backend because no authored program can produce the bad input: the CLI sends
 * every project source and the fork answers about those, so an unrecognised
 * name means the protocol has already been broken. Both directions are pinned —
 * a correctly attributed diagnostic must still land on its real file, and a
 * project-level diagnostic must still be reported rather than refused.
 */
test("a Go diagnostic is attributed to the request source it names, or to none", async () => {
  const { GoBackendFailure, resolveGoDiagnosticFile } = await import("../dist/go-backend.js");
  const sources = new Set(["main.sm", "nested/helper.sm"]);

  // The ordinary case, and the one a fail-closed guard must not break.
  assert.equal(resolveGoDiagnosticFile("main.sm", sources), "main.sm");
  assert.equal(resolveGoDiagnosticFile("nested/helper.sm", sources), "nested/helper.sm");

  // Project-level: no file, so no file is claimed.
  assert.equal(resolveGoDiagnosticFile(undefined, sources), undefined);
  assert.equal(resolveGoDiagnosticFile("", sources), undefined);

  // The defect: a name the request never sent used to become "main.sm".
  assert.throws(
    () => resolveGoDiagnosticFile("elsewhere.sm", sources),
    (error) => {
      assert.ok(error instanceof GoBackendFailure);
      assert.equal(error.code, "SMITHERS_GO_PROTOCOL");
      assert.match(error.message, /"elsewhere\.sm"/);
      assert.match(error.message, /not one of the 2 source file\(s\)/);
      assert.match(error.message, /"main\.sm"/);
      return true;
    },
  );

  // A near miss is still a miss: an absolute path is not the logical name the
  // request sent, and silently accepting one would reopen the same hole.
  assert.throws(
    () => resolveGoDiagnosticFile("/tmp/project/main.sm", sources),
    { code: "SMITHERS_GO_PROTOCOL" },
  );
});
