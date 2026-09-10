import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const forkManifest = JSON.parse(readFileSync(join(repositoryRoot, "typescript-fork.json"), "utf8"));
const forkSeries = JSON.parse(readFileSync(join(repositoryRoot, "compiler/forkpatch/series.json"), "utf8"));

function runVibeLang(args, env = {}) {
  return spawnSync(process.execPath, ["bin/vibe.js", ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 360_000,
    maxBuffer: 128 * 1024 * 1024,
  });
}

/**
 * Where a consumer looks for the pinned checkout when neither
 * `VIBELANG_TYPESCRIPT_FORK` nor `VIBELANG_TYPESCRIPT_FORK_CACHE` is set. Shared
 * with the drift gate below so that gate reads the live array rather than a copy.
 */
const CONSUMER_CACHE_ROOTS = ["/private/tmp/vibelang-ts-fork-cache", join(tmpdir(), "vibelang-ts-fork-cache")];

function locateForkCheckout() {
  const configured = process.env.VIBELANG_TYPESCRIPT_FORK;
  if (configured) return existsSync(configured) ? resolve(configured) : undefined;
  const cacheRoots = process.env.VIBELANG_TYPESCRIPT_FORK_CACHE
    ? [resolve(process.env.VIBELANG_TYPESCRIPT_FORK_CACHE)]
    : CONSUMER_CACHE_ROOTS;
  return cacheRoots
    .map((cache) => join(cache, forkManifest.revision))
    .find((checkout) => existsSync(join(checkout, "go.work")));
}

const forkCheckout = locateForkCheckout();
const missingForkMessage = "source checkout unavailable for the build-isolation probe";

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
  const root = mkdtempSync(join(tmpdir(), "vibelang-cli-pristine-fork-"));
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

/**
 * Every file that names a TypeScript-fork cache root, and whether it produces
 * one or consumes one. A name here is a *directory* name, not the
 * `--fork-cache` flag (that is the bridge *binary* cache, a different thing) and
 * not `conformance/runner`'s per-workspace `"fork-cache"` scratch directory.
 */
const FORK_CACHE_NAME_SITES = [
  "scripts/prepare-typescript-fork.mjs",
  "scripts/go-test-gate.mjs",
  "scripts/fork-e2e.mjs",
  "poc/src/compiler/native.ts",
  "test/cli-go-backend.test.mjs",
];

/** Files whose user-facing remedy text spells the preparation command out. */
const FORK_CACHE_REMEDY_SITES = [
  "test/fork-e2e.test.mjs",
  "conformance/runner/backend-go.mjs",
  "scripts/go-test-gate.mjs",
];

/**
 * The producer and the consumers must name ONE cache directory.
 *
 * `scripts/prepare-typescript-fork.mjs` is the only writer; the source-only
 * preparation path in `poc/src/compiler/native.ts`,
 * `scripts/go-test-gate.mjs`, `scripts/fork-e2e.mjs` and this file are the
 * readers. They drifted — the writer defaulted to
 * `vibelang-typescript-fork-cache` while every reader searched
 * `vibelang-ts-fork-cache` — so the documented bare command
 * `node scripts/prepare-typescript-fork.mjs --fetch` prepared a real checkout
 * into a directory no reader looks in, and the backend then reported
 * `VIBELANG_GO_CHECKOUT_MISSING` on a machine that had just prepared one.
 *
 * A one-shot equality assertion would have caught that and nothing since, so
 * this derives both sides: the readers' side is `CONSUMER_CACHE_ROOTS` itself
 * (the array `locateForkCheckout` uses), and the writers'/other readers' side is
 * every quoted cache-directory literal in the files above.
 */
test("the fork preparation script writes the cache directory native build tooling reads", () => {
  const quotedCacheName = /"(?:\/private\/tmp\/)?((?:[a-z0-9]+-)+fork-cache)"/g;
  const named = new Map();
  for (const relative of FORK_CACHE_NAME_SITES) {
    const source = readFileSync(join(repositoryRoot, relative), "utf8");
    for (const [, name] of source.matchAll(quotedCacheName)) {
      (named.get(name) ?? named.set(name, []).get(name)).push(relative);
    }
  }
  assert.deepEqual(
    [...named.keys()].sort(),
    ["vibelang-ts-fork-cache"],
    `the fork cache directory name has drifted: ${
      [...named].map(([name, sites]) => `${name} in ${[...new Set(sites)].join(", ")}`).join("; ")
    }`,
  );

  // The consumers' own search array must be built from that one name, so a
  // rename cannot pass by editing only the literals above.
  assert.deepEqual(
    CONSUMER_CACHE_ROOTS,
    ["/private/tmp/vibelang-ts-fork-cache", join(tmpdir(), "vibelang-ts-fork-cache")],
  );

  // And the remedy the tools print must be a command that produces it. This is
  // the half that was actually load-bearing: the text was already right, and it
  // was the script's default that disagreed with it.
  for (const relative of FORK_CACHE_REMEDY_SITES) {
    const source = readFileSync(join(repositoryRoot, relative), "utf8");
    // Only literal paths: `go-test-gate.mjs` interpolates the root it just
    // resolved, which is the same array this test already checks directly.
    for (const [, target] of source.matchAll(/prepare-typescript-fork\.mjs --fetch --cache (\/[^\s`"'$}]+)/g)) {
      assert.ok(
        CONSUMER_CACHE_ROOTS.includes(target),
        `${relative} tells the operator to prepare ${target}, which no consumer searches`,
      );
    }
  }
});

test("--backend go uses its packaged compiler with no checkout or Go executable", () => {
  const absent = join(tmpdir(), `vibelang-c19-absent-${process.pid}`);
  assert.equal(existsSync(absent), false);
  const result = runVibeLang([
    "check",
    "test/fixtures/basic.vibe",
    "--backend",
    "go",
    "--format",
    "json",
  ], { VIBELANG_TYPESCRIPT_FORK: absent, VIBELANG_GO: join(absent, "go"), PATH: "" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = parsedPureJson(result);
  assert.equal(report.ok, true);
  assert.deepEqual(report.files[0].diagnostics, []);
});

test("--backend go fails closed for an unavailable explicit native executable", () => {
  const absent = join(tmpdir(), `vibelang-native-absent-${process.pid}`);
  assert.equal(existsSync(absent), false);
  const result = runVibeLang(["check", "test/fixtures/basic.vibe", "--backend", "go", "--format", "json"], {
    VIBELANG_NATIVE_COMPILER: absent,
  });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = parsedPureJson(result);
  assert.equal(report.code, "VIBELANG_GO_INSTALLATION");
  assert.match(report.message, /Native compiler executable is unavailable/);
  assert.match(report.message, /matching VibeLang native package/);
  assert.doesNotMatch(report.message, /--backend js/);
});

test("JS and Go run backends execute identical Result lifting and postfix propagation", {
}, (t) => {
  const project = mkdtempSync(join(tmpdir(), "vibelang-cli-backend-parity-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const source = join(project, "main.vibe");
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
    const result = runVibeLang(["run", source, "--backend", backend, "--format", "json"], {
      VIBELANG_TYPESCRIPT_FORK: forkCheckout,
    });
    assert.equal(result.status, 0, `${backend}: ${result.stderr || result.stdout}`);
    const report = parsedPureJson(result);
    assert.equal(report.output, "ok:6\nerror:negative\n");
    assert.equal(report.errorOutput, "");
    reports.set(backend, report);
  }
  assert.deepEqual(reports.get("go"), reports.get("js"));

  const defaultResult = runVibeLang(["run", source, "--format", "json"]);
  assert.equal(defaultResult.status, 0, defaultResult.stderr || defaultResult.stdout);
  assert.deepEqual(parsedPureJson(defaultResult), reports.get("js"));
});

test("both backend JSON reports keep authored diagnostic positions and one report shape", {
}, (t) => {
  const project = mkdtempSync(join(tmpdir(), "vibelang-cli-backend-diagnostic-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const source = join(project, "invalid.vibe");
  writeFileSync(source, [
    "class BadValue extends Error {}",
    "function invalid(): Result<number, BadValue> {",
    "  return \"wrong\"",
    "}",
    "",
  ].join("\n"));
  const canonicalSource = realpathSync(source);

  for (const backend of ["js", "go"]) {
    const result = runVibeLang(["check", source, "--backend", backend, "--format", "json"], {
      VIBELANG_TYPESCRIPT_FORK: forkCheckout,
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

test("--backend go neither uses nor mutates an unrelated pristine build checkout", {
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

  const result = runVibeLang([
    "check",
    "test/fixtures/basic.vibe",
    "--backend",
    "go",
    "--format",
    "json",
  ], { VIBELANG_TYPESCRIPT_FORK: pristine });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = parsedPureJson(result);
  assert.equal(report.ok, true);
  const after = spawnSync(process.execPath, ["compiler/forkpatch/forkpatch.mjs", "status", "--checkout", pristine], {
    cwd: repositoryRoot, encoding: "utf8",
  });
  assert.equal(after.status, 0, after.stderr || after.stdout);
  assert.equal(JSON.parse(after.stdout).state, "pristine");
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
  const sources = new Set(["main.vibe", "nested/helper.vibe"]);

  // The ordinary case, and the one a fail-closed guard must not break.
  assert.equal(resolveGoDiagnosticFile("main.vibe", sources), "main.vibe");
  assert.equal(resolveGoDiagnosticFile("nested/helper.vibe", sources), "nested/helper.vibe");

  // Project-level: no file, so no file is claimed.
  assert.equal(resolveGoDiagnosticFile(undefined, sources), undefined);
  assert.equal(resolveGoDiagnosticFile("", sources), undefined);

  // The defect: a name the request never sent used to become "main.vibe".
  assert.throws(
    () => resolveGoDiagnosticFile("elsewhere.vibe", sources),
    (error) => {
      assert.ok(error instanceof GoBackendFailure);
      assert.equal(error.code, "VIBELANG_GO_PROTOCOL");
      assert.match(error.message, /"elsewhere\.vibe"/);
      assert.match(error.message, /not one of the 2 source file\(s\)/);
      assert.match(error.message, /"main\.vibe"/);
      return true;
    },
  );

  // A near miss is still a miss: an absolute path is not the logical name the
  // request sent, and silently accepting one would reopen the same hole.
  assert.throws(
    () => resolveGoDiagnosticFile("/tmp/project/main.vibe", sources),
    { code: "VIBELANG_GO_PROTOCOL" },
  );
});

/**
 * Foreign `.ts`/`.js` dependencies reach the Go request.
 *
 * **Why here, and not anywhere else that already looked green.** The Go request
 * is built in `compileGoVibeLangFiles`, and only the CLI builds it. Nothing else
 * in the repository walks that code path: `poc/src/platform/platform.vibe.test.ts`
 * calls `compileAndCheckProject` from `poc/src/language`, which is the reference
 * frontend in-process and never produces a Go request at all; and the
 * conformance corpus stages its foreign `.ts` through
 * `conformance/runner/backend-go.mjs`, which assembles its own request from the
 * case's `typescript` list. Both are therefore structurally blind to what the
 * CLI sends. So "531/531 Go gate, 364 conformance cases, 0 divergent" was true
 * at the same time as `--backend go` being unable to compile a single `.vibe` that
 * imports a foreign `.ts` — the whole ported platform standard library and the
 * repository's own `poc/examples/language/demo.vibe` included. The request used to
 * be `project.sources.map(... kind: "vibelang" ...)` over a walk that collects
 * only `.vibe`, so the `"typescript"` kind the protocol has always declared was
 * produced by nothing, `ResolveExternalModuleName` returned nil, and every
 * foreign import was refused with VIBE1510 — the right code for the wrong
 * reason.
 *
 * This file is the location that can see it: it spawns `bin/vibe.js` against
 * a real on-disk project, which is the only way the request producer runs, and
 * it is discovered by `scripts/node-test-gate.mjs` like every other
 * `test/*.test.mjs`.
 *
 * **Both directions are asserted, because the fail-open is the real hazard.**
 * Making foreign modules resolve is exactly the change that could turn a
 * genuine trust refusal into an acceptance: before staging, an untrusted module
 * was refused because nothing resolved, which is safe by accident. So the
 * untrusted cases below assert the *reason* — the message must name the missing
 * `@module`/`@throws {never}` claim and must not say the module could not be
 * resolved — and the transitive case pins the one an unstaged backend cannot
 * reach on its own.
 */
function writeProject(t, name, files) {
  const root = mkdtempSync(join(tmpdir(), `vibelang-cli-foreign-${name}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [relativeName, text] of Object.entries(files)) {
    const target = join(root, relativeName);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  return root;
}

function checkedByBothBackends(entry) {
  const observed = new Map();
  for (const backend of ["js", "go"]) {
    const result = runVibeLang(["check", entry, "--backend", backend, "--format", "json"], {
      VIBELANG_TYPESCRIPT_FORK: forkCheckout,
    });
    observed.set(backend, { status: result.status, report: parsedPureJson(result) });
  }
  return observed;
}

const TRUSTED = "/** @module @throws {never} */\n";

test("--backend go stages the foreign dependencies a .vibe project imports", {
}, (t) => {
  // One project, several members of the class at once: a direct `./x.ts`, a
  // foreign module that imports another foreign module, a foreign module two
  // `.vibe` files share, a `.vibe` that is itself imported doing the importing, a
  // type-only edge, a namespace-free re-export, and an asset beside a foreign
  // import. Each was independently measured broken before staging.
  const root = writeProject(t, "resolves", {
    "main.vibe": [
      `import { top } from "./chain.ts"`,
      `import { shared } from "./shared.ts"`,
      `import { fromLib } from "./lib.vibe"`,
      `import type { Shape } from "./shapes.ts"`,
      `import label from "./label.json" with { type: "json" }`,
      `export function main(shape: Shape): string {`,
      `  return top + shared + fromLib() + shape.name + label.name`,
      `}`,
      ``,
    ].join("\n"),
    "lib.vibe": [
      `import { shared } from "./shared.ts"`,
      `export function fromLib(): string { return shared }`,
      ``,
    ].join("\n"),
    "chain.ts": `${TRUSTED}import { bottom } from "./bottom.ts";\nexport const top = bottom + "-top";\n`,
    "bottom.ts": `${TRUSTED}export const bottom = "bottom";\n`,
    "shared.ts": `${TRUSTED}export const shared = "shared";\n`,
    "shapes.ts": `export interface Shape { readonly name: string }\n`,
    "label.json": `{ "name": "label" }\n`,
  });

  const observed = checkedByBothBackends(join(root, "main.vibe"));
  for (const [backend, { status, report }] of observed) {
    assert.equal(
      status,
      0,
      `${backend} refused a project whose every foreign edge is trusted: ${JSON.stringify(report, null, 2)}`,
    );
    assert.equal(report.ok, true);
    assert.deepEqual(report.files.flatMap((file) => file.diagnostics), []);
  }
});

test("--backend go refuses an untrusted foreign module for its trust claim, not for failing to resolve", {
}, (t) => {
  const root = writeProject(t, "untrusted", {
    "main.vibe": `import { value } from "./untrusted.ts"\nexport function main(): string { return value }\n`,
    "untrusted.ts": `export const value = "untrusted";\n`,
  });

  const observed = checkedByBothBackends(join(root, "main.vibe"));
  for (const [backend, { status, report }] of observed) {
    assert.equal(status, 1, `${backend} accepted an untrusted foreign module`);
    assert.equal(report.ok, false);
    const refusals = report.files.flatMap((file) => file.diagnostics)
      .filter((diagnostic) => diagnostic.code === "VIBE1510");
    assert.equal(refusals.length, 1, `${backend}: ${JSON.stringify(report, null, 2)}`);
    // The distinction this whole test exists for. "Could not be resolved" is
    // what the backend said before the sources were staged, and it is not a
    // trust verdict: it would have been said just as loudly about a module that
    // carries the claim.
    assert.match(refusals[0].message, /@module and @throws \{never\}/);
    assert.doesNotMatch(refusals[0].message, /could not be resolved/);
    assert.equal(realpathSync(refusals[0].file), realpathSync(join(root, "untrusted.ts")));
  }
  assert.deepEqual(observed.get("go").report, observed.get("js").report);
});

test("--backend go still refuses a foreign graph that is untrusted transitively", {
}, (t) => {
  // The fail-open staging could have opened. The fork's own module-trust check
  // reads the edges an authored `.vibe` spells, so a facade that carries the claim
  // and re-exports a module that does not is trusted from that side alone;
  // importing the facade still evaluates the untrusted module. The relative
  // runtime graph computes the transitive static-initialization closure, and the
  // CLI stops on it before either backend runs.
  const root = writeProject(t, "transitive", {
    "main.vibe": `import { value } from "./facade.ts"\nexport function main(): string { return value }\n`,
    "facade.ts": `${TRUSTED}export { value } from "./untrusted.ts";\n`,
    "untrusted.ts": `export const value = "untrusted";\n`,
  });

  const observed = checkedByBothBackends(join(root, "main.vibe"));
  for (const [backend, { status, report }] of observed) {
    assert.equal(status, 1, `${backend} accepted a transitively untrusted foreign graph`);
    const refusals = report.files.flatMap((file) => file.diagnostics)
      .filter((diagnostic) => diagnostic.code === "VIBE1510");
    assert.equal(refusals.length, 1, `${backend}: ${JSON.stringify(report, null, 2)}`);
    assert.equal(realpathSync(refusals[0].file), realpathSync(join(root, "untrusted.ts")));
  }
  assert.deepEqual(observed.get("go").report, observed.get("js").report);
});

test("--backend go refuses a foreign dependency outside the project root", {
}, (t) => {
  // The project root is inferred from the single input, so it is `project/` and
  // `../escaped.ts` is outside it. Reusing the reference walk is what makes this
  // refusal reach the Go path at all: it used to answer with VIBE1510 for
  // the unresolved module instead, which named neither the escape nor the file.
  const root = writeProject(t, "escape", {
    "escaped.ts": `${TRUSTED}export const value = "escaped";\n`,
    "project/main.vibe": `import { value } from "../escaped.ts"\nexport function main(): string { return value }\n`,
  });

  for (const backend of ["js", "go"]) {
    const result = runVibeLang(["check", join(root, "project/main.vibe"), "--backend", backend, "--format", "json"], {
      VIBELANG_TYPESCRIPT_FORK: forkCheckout,
    });
    assert.equal(result.status, 2, `${backend} admitted a dependency outside the project root`);
    const report = parsedPureJson(result);
    assert.equal(report.code, "VIBELANG_PROJECT_ERROR");
    assert.match(report.message, /outside the project root/);
  }
});

test("a .vibe project with no foreign dependency compiles identically on both backends", {
}, (t) => {
  // The control for the staging change: a request that gains no staged sources
  // must be the request it always was. Two `.vibe` files, one importing the other,
  // so the walk runs and produces an empty foreign set rather than never running.
  const root = writeProject(t, "none", {
    "main.vibe": [
      `import { doubled, InvalidScore } from "./helper.vibe"`,
      `export function main(value: number): Result<number, InvalidScore> {`,
      `  const checked = doubled(value)!`,
      `  return checked + 1`,
      `}`,
      ``,
    ].join("\n"),
    "helper.vibe": [
      `export class InvalidScore extends Error {}`,
      `export function doubled(value: number): Result<number, InvalidScore> {`,
      `  if (value < 0) throw new InvalidScore("negative")`,
      `  return value * 2`,
      `}`,
      ``,
    ].join("\n"),
  });

  const observed = checkedByBothBackends(join(root, "main.vibe"));
  for (const [backend, { status, report }] of observed) {
    assert.equal(status, 0, `${backend}: ${JSON.stringify(report, null, 2)}`);
    assert.equal(report.ok, true);
    assert.deepEqual(report.files.flatMap((file) => file.diagnostics), []);
  }
});
