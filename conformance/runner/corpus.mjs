/**
 * Corpus discovery and expectation parsing.
 *
 * A conformance case is one authored `.sm` file under `conformance/corpus/<area>/`
 * whose name does not end in `.mod.sm` (those are auxiliary modules imported by a
 * case), paired with a sibling `<case>.expected.json`.
 *
 * The expectation lives beside the source rather than inside it so the `.sm` file
 * stays pristine authored Smithers: line 1 of the case is line 1 of the program,
 * which is what lets a negative case name the exact authored line and column of
 * its diagnostic without those numbers shifting whenever the expectation is
 * edited. It also means every corpus file can be fed straight to the CLI.
 *
 * See conformance/README.md for the schema.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The comptime target every case is compiled under, on **both** backends.
 *
 * `comptime.target` is a declared compiler input, and a target-selected branch
 * folds a different constant into the emitted program. So a differential run
 * that hands the two backends different targets is not comparing two
 * implementations of one program — it is comparing two programs, and neither
 * backend reports anything about it.
 *
 * That is what this harness used to do. The JS driver pinned `"node-es2022"`
 * for its comptime and asset compilers while the Go request sent `options: {}`
 * and the bridge fell back to its own default, `"typescript-node"`. Nothing
 * caught it because the only case that reads the target branches on
 * `=== "browser"`, and both defaults take the same arm. A latent divergence in
 * the equality relation is worse than a divergence in a backend, because every
 * other number on the scoreboard is computed through it.
 *
 * The specification does not name a default target
 * (`specification/comptime.mdx`), so this constant is the harness's choice
 * rather than a language rule — which is exactly why it is written down once,
 * sent explicitly to both backends, and pinned by
 * `16-comptime/the-comptime-target-is-one-declared-input-for-both-backends`.
 */
export const comptimeTarget = "node-es2022";

/**
 * The lowering mode every Go request declares — the probe, every case, and every
 * interop file — written down once so the harness cannot send an implicit one.
 *
 * `"internal"` is the migration target: the fork's own parser, checker, printer
 * and Go Smithers lowering. `"external"` would have the JS instrument do the
 * lowering and measure the reference again; `"identity"` runs the stock
 * TypeScript checker over the TypeScript-shaped subset and applies **no
 * Smithers rule at all**.
 *
 * That last mode is why this is a constant rather than three string literals.
 * `compiler.LoweringIdentity` used to be the empty string, i.e. the zero value
 * of `LoweringMode`, and `cmd/smithersc-go` built positional requests with no
 * `Lowering` field — so every positional invocation silently selected identity
 * and compiled `.sm` through the TypeScript checker only. It is fixed at both
 * ends (`compiler/api.go:54`, `compiler/lowered.go:19`), and the modes are
 * measurably not interchangeable: sent the same two-file program, `"internal"`
 * reports SMITHERS1510 and SMITHERS1301 while `"identity"` exits 0 with zero
 * diagnostics.
 *
 * No corpus case can observe any of that, because the runner always sends a
 * mode explicitly — which is precisely the shape of defect a corpus cannot
 * catch and a harness self-test can. See `conformance/runner/selftest.mjs`,
 * `the harness never sends an implicit lowering mode`.
 */
export const loweringMode = "internal";

/** The modes `compiler/lowered.go` accepts. The empty string is not one. */
export const loweringModes = Object.freeze(["identity", "external", "internal"]);

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const corpusRoot = join(repositoryRoot, "conformance", "corpus");
export const supportRoot = join(repositoryRoot, "conformance", "support");
export const assetRoot = join(repositoryRoot, "conformance", "assets");
export const interopRoot = join(repositoryRoot, "conformance", "interop");

/** Ordered area list; the directory name prefix keeps report order stable. */
export function areaOf(caseFile) {
  return relative(corpusRoot, dirname(caseFile)).split("/")[0];
}

function readExpectation(expectationPath, path) {
  let text;
  try {
    text = readFileSync(expectationPath, "utf8");
  } catch {
    throw new Error(`${path}: missing the sibling ${basename(expectationPath)} expectation`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${basename(expectationPath)}: expectation must be JSON (${error.message})`);
  }
}

/**
 * A declared diagnostic is a Smithers rule (`SMITHERS1205`), a compiler-owned
 * comptime rule (`VCT1004`), or, for syntax Smithers shares with TypeScript and
 * whose behavior it keeps, the stock TypeScript diagnostic itself (`TS2678`).
 */
const DIAGNOSTIC_CODE = /^(SMITHERS\d{4}|VCT\d{4}|TS\d{4,5})$/;

const KNOWN_FIELDS = new Set([
  "title",
  "expect",
  "stdout",
  "diagnostics",
  "modules",
  "typescript",
  "assets",
  "entry",
  "xfail",
  "notes",
]);

/**
 * A staged non-code file: the path a case's authored `.sm` imports.
 *
 * Kept deliberately narrow. The Go bridge stages a case entirely in-request and
 * refuses any input path that escapes its virtual project
 * (`compiler/forkbridge/main.go.txt`, `virtualFileName`), so a staged path that
 * both backends can honour is a relative POSIX path beneath the project root and
 * nothing else. Anything wider would stage differently on the two backends,
 * which is the one thing a differential harness must never do.
 */
function normalizeAssetEntry(entry, path, staged) {
  const from = typeof entry === "string" ? entry : entry?.from;
  const target = typeof entry === "string" ? entry : (entry?.path ?? entry?.from);
  if (typeof from !== "string" || from.length === 0 || typeof target !== "string" || target.length === 0) {
    throw new Error(`${path}: every asset is "name.ext" or { from, path }`);
  }
  if (typeof entry === "object") {
    for (const key of Object.keys(entry)) {
      if (key !== "from" && key !== "path") throw new Error(`${path}: unknown asset field ${JSON.stringify(key)}`);
    }
  }
  for (const [label, value] of [["source name", from], ["staged path", target]]) {
    if (value.includes("\\") || value.startsWith("/")) {
      throw new Error(`${path}: asset ${label} ${JSON.stringify(value)} must be a relative POSIX path`);
    }
    if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new Error(`${path}: asset ${label} ${JSON.stringify(value)} must not contain "." or ".." segments`);
    }
  }
  if (from.includes("/")) {
    throw new Error(`${path}: asset source ${JSON.stringify(from)} must name a file directly in conformance/assets/`);
  }
  if (/\.sm$/.test(target)) {
    throw new Error(`${path}: asset ${JSON.stringify(target)} must not be staged with a .sm extension`);
  }
  if (staged.has(target)) throw new Error(`${path}: two files are staged at ${JSON.stringify(target)}`);
  staged.add(target);
  return { from, target };
}

function validate(expectation, path) {
  for (const key of Object.keys(expectation)) {
    if (!KNOWN_FIELDS.has(key)) throw new Error(`${path}: unknown expectation field ${JSON.stringify(key)}`);
  }
  if (typeof expectation.title !== "string" || expectation.title.length === 0) {
    throw new Error(`${path}: expectation needs a title`);
  }
  if (expectation.expect !== "output" && expectation.expect !== "diagnostics") {
    throw new Error(`${path}: expect must be "output" or "diagnostics"`);
  }
  if (expectation.expect === "output") {
    if (!Array.isArray(expectation.stdout) || expectation.stdout.some((line) => typeof line !== "string")) {
      throw new Error(`${path}: an output case needs a stdout array of strings`);
    }
    if (expectation.diagnostics !== undefined) {
      throw new Error(`${path}: an output case must not declare diagnostics`);
    }
  } else {
    if (!Array.isArray(expectation.diagnostics) || expectation.diagnostics.length === 0) {
      throw new Error(`${path}: a diagnostics case needs a non-empty diagnostics array`);
    }
    for (const entry of expectation.diagnostics) {
      if (typeof entry?.code !== "string" || !DIAGNOSTIC_CODE.test(entry.code)) {
        throw new Error(`${path}: every expected diagnostic needs a SMITHERSnnnn, VCTnnnn, or TSnnnn code`);
      }
      // A `TS` code is a claim about *TypeScript's* behavior on shared syntax,
      // which the compatibility rule says Smithers keeps. Such a claim is only
      // as good as the evidence behind it, so the case has to carry it.
      if (entry.code.startsWith("TS") && (typeof expectation.notes !== "string" || expectation.notes.length === 0)) {
        throw new Error(
          `${path}: a case expecting the stock TypeScript diagnostic ${entry.code} must record the evidence in "notes"`,
        );
      }
      if (!Number.isInteger(entry.line) || entry.line < 1) {
        throw new Error(`${path}: expected diagnostic ${entry.code} needs a 1-based authored line`);
      }
      if (!Number.isInteger(entry.column) || entry.column < 1) {
        throw new Error(`${path}: expected diagnostic ${entry.code} needs a 1-based authored column`);
      }
      // Optional, and deliberately a substring rather than the whole message.
      // Some rules carry a payload that IS the promise — the native pin's
      // dependency path is the example this was added for: a pin refused with
      // an empty route satisfies a code-and-position expectation exactly, and
      // "the diagnostic SHOULD show the dependency path that introduced the
      // requirement" (specification/compatibility.mdx, Native Pin) would then
      // be unpinned. Message *wording* is not the contract and legitimately
      // differs between the backends, so a case names the smallest fragment
      // that carries the promise and never the sentence around it.
      if (entry.messageContains !== undefined) {
        if (typeof entry.messageContains !== "string" || entry.messageContains.length === 0) {
          throw new Error(`${path}: ${entry.code}'s messageContains must be a non-empty substring of the message`);
        }
      }
      for (const key of Object.keys(entry)) {
        if (!["code", "line", "column", "messageContains"].includes(key)) {
          throw new Error(`${path}: unknown field ${JSON.stringify(key)} on expected diagnostic ${entry.code}`);
        }
      }
    }
    if (expectation.stdout !== undefined) {
      throw new Error(`${path}: a diagnostics case must not declare stdout`);
    }
  }
  if (expectation.assets !== undefined && !Array.isArray(expectation.assets)) {
    throw new Error(`${path}: assets must be an array`);
  }
  if (expectation.xfail !== undefined) {
    const { backends, reason, doc } = expectation.xfail;
    if (!Array.isArray(backends) || backends.length === 0) {
      throw new Error(`${path}: xfail needs a non-empty backends array`);
    }
    for (const backend of backends) {
      if (backend !== "js" && backend !== "go") throw new Error(`${path}: unknown xfail backend ${backend}`);
    }
    if (typeof reason !== "string" || reason.length === 0) throw new Error(`${path}: xfail needs a reason`);
    if (typeof doc !== "string" || doc.length === 0) {
      throw new Error(`${path}: xfail needs the doc it cites`);
    }
  }
}

function walk(directory, out) {
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      continue;
    }
    if (!entry.endsWith(".sm") || entry.endsWith(".mod.sm")) continue;
    out.push(path);
  }
  return out;
}

/**
 * Load every case. Each case carries its staged files as `{ path, kind, text }`
 * with POSIX paths relative to the project root.
 *
 * Three kinds, and both backends stage all three from this one list so the two
 * observations are of the same project:
 *
 *   smithers    the authored `.sm` entry plus any `*.mod.sm` sibling it imports
 *   typescript  foreign `.ts` modules from `conformance/support/`
 *   asset       non-code files from `conformance/assets/` — `.json`, `.md`,
 *               `.mdx`, `.txt`, and custom-loader inputs such as `.yaml` — put
 *               at exactly the path the authored `.sm` imports, so an asset
 *               import is a real compiler-tracked file read rather than a stub
 */
export function loadCorpus({ filter } = {}) {
  const cases = [];
  for (const path of walk(corpusRoot, [])) {
    const text = readFileSync(path, "utf8");
    const expectation = readExpectation(path.replace(/\.sm$/, ".expected.json"), relative(repositoryRoot, path));
    validate(expectation, relative(repositoryRoot, path));

    const entry = basename(path);
    const files = [{ path: entry, kind: "smithers", text }];
    const staged = new Set([entry]);
    for (const moduleName of expectation.modules ?? []) {
      files.push({
        path: moduleName,
        kind: "smithers",
        text: readFileSync(join(dirname(path), moduleName), "utf8"),
      });
      staged.add(moduleName);
    }
    for (const supportName of expectation.typescript ?? []) {
      files.push({
        path: supportName,
        kind: "typescript",
        text: readFileSync(join(supportRoot, supportName), "utf8"),
      });
      staged.add(supportName);
    }
    for (const declared of expectation.assets ?? []) {
      const asset = normalizeAssetEntry(declared, relative(repositoryRoot, path), staged);
      files.push({
        path: asset.target,
        kind: "asset",
        text: readFileSync(join(assetRoot, asset.from), "utf8"),
      });
    }

    const id = relative(corpusRoot, path).replace(/\.sm$/, "");
    if (filter && !id.includes(filter)) continue;
    cases.push({
      id,
      area: areaOf(path),
      name: basename(path, ".sm"),
      sourcePath: path,
      entry,
      files,
      expectation,
    });
  }
  return cases;
}

/** Map a UTF-16 offset in `text` to a 1-based line and column. */
export function lineColumnOf(text, offset) {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** Load the plain-TypeScript interop spot-check files. */
export function loadInterop({ filter } = {}) {
  const cases = [];
  for (const entry of readdirSync(interopRoot).sort()) {
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    const path = join(interopRoot, entry);
    const text = readFileSync(path, "utf8");
    const expectationPath = path.replace(/\.ts$/, ".expected.json");
    const expectation = JSON.parse(readFileSync(expectationPath, "utf8"));
    const id = basename(entry, ".ts");
    if (filter && !id.includes(filter)) continue;
    cases.push({ id, entry, sourcePath: path, text, expectation });
  }
  return cases;
}
