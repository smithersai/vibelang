#!/usr/bin/env node
// Diagnostic-code census for conformance/COVERAGE.md.
//
// WHY THIS FILE EXISTS. COVERAGE.md's two subtractions are the page's central
// claims: "rules the reference implements and the fork does not" and "rules both
// implementations have and no case probes". Both were derived by grepping the
// literal string `SMITHERS[0-9]{4}` over whole directories. That command cannot
// tell a code an implementation *reports* from a code a comment *mentions*, and
// the page recorded six confirmed miscounts from exactly that defect before this
// script replaced it:
//
//   SMITHERS1805  counted in the reference from poc/src/language/README.md prose
//                 recording its own RETIREMENT.
//   SMITHERS1708  counted in the fork from three design-document sentences
//                 saying the fork RETIRES it.
//   SMITHERS4121  counted in the fork from one comment in an UNTRACKED Go test.
//   SMITHERS1105  counted as fork-implemented from THREE code comments
//                 (compiler/fork_panic_test.go:81,177,
//                 compiler/forkbridge/mustconsume.go.txt:60), every one of them
//                 describing the REFERENCE's behaviour. The fork implements no
//                 SMITHERS1105.
//   SMITHERS1807  counted in the reference after step 13 RETIRED it, from
//                 comments recording the retirement.
//   SMITHERS4106/4107  counted in BOTH after step 11 withdrew the branch and
//                 loop walls, from `// WALL n (4106), withdrawn.` comments.
//
// Every one of those is a fail-OPEN about the codebase itself: a rule nothing
// implements reads as implemented, and a rule nothing probes reads as probed.
//
// THE RULE THIS SCRIPT APPLIES. A code counts for an implementation only at a
// REPORT SITE: a place the source constructs a diagnostic carrying it. Concretely
// a report site is a string literal WHOSE ENTIRE CONTENT IS THE CODE, appearing
// in comment-stripped, non-test, non-prose implementation source, and not in one
// of two positions that name a code without reporting it.
//
// The rule is stated as "count it unless it is one of these" rather than as a
// list of accepted syntactic shapes, and that direction is deliberate. This
// census feeds a subtraction whose result is "rules nothing probes": UNDERcounting
// an implementation shrinks the intersection and makes the ledger claim FEWER
// unprobed rules than there are, which is the same fail-open the script exists to
// remove. Overcounting is merely pessimistic. So a shape nobody anticipated is
// counted, and only the shapes proven not to report are dropped.
//
// This deliberately does NOT count:
//   - line and block comments (`// WALL 1 (4106), withdrawn.`) — stripped
//   - markdown and other prose (`compiler/FORK-SEAM-DESIGN.md`, `**/*.mdx`) —
//     not read at all; this is where SMITHERS1708 and SMITHERS1702/1707/1709/
//     1710/1714/1715 live, every one of them in a sentence saying the fork
//     RETIRES the rule
//   - test files (`*.test.ts`, `*_test.go`) — a test that MENTIONS a code is
//     not an implementation that reports it; this is the SMITHERS4117/4121 trap
//   - a code inside a LONGER string (`"SMITHERS1604 is the precedent"`) — the
//     report sites in this tree are all exactly `"SMITHERSNNNN"`, so a code
//     embedded in a message or a prose string is a mention
//   - equality comparisons (`diagnostic.code === "SMITHERS1151"`) — a consumer
//     filtering on a code is not a producer of it
//   - type-union members (`code: "SMITHERS6001" | "SMITHERS6002" | ...`) — a
//     declaration of the code SPACE, not a report of a code
//
// Run `node scripts/coverage-codes.mjs shapes` to see every accepted occurrence
// with its preceding context, which is the evidence for the rule.
//
// CONSTRUCTED CODES. The fork builds durable codes by concatenating a prefix
// constant with a bare digit suffix (`compiler/forkbridge/durable.go.txt:28`,
// `const durableDiagnosticPrefix = "SMITHERS"`), so no literal-code grep can see
// them. In any file that defines such a prefix constant, a BARE four-digit string
// literal in a report position (argument, or a `suffix:` field feeding one)
// counts too. The reference constructs none — asserted, not assumed, by
// `assertNoUndetectedConstruction`.
//
// FALSIFIABILITY. `node scripts/coverage-codes.mjs selftest` runs the extractor
// over scripts/coverage-codes-fixture/, which spells every mention shape that
// ever fooled the old method next to real report sites. If the extractor
// regresses to counting mentions, the mention-only codes leak into the result and
// the selftest fails. It is wired into `test/coverage-codes.test.mjs`, which
// `scripts/node-test-gate.mjs` runs.
//
// RESIDUALS. Anything this script drops is REPORTED, never silently discarded:
// `subtraction` prints, for each half, every code that survives comment-stripping
// but reaches no report site. A code appearing there is a claim to audit, not a
// number to trust.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CODE_RE = /SMITHERS[0-9]{4}/g;

// --------------------------------------------------------------------------
// Comment stripping
// --------------------------------------------------------------------------

/**
 * Replace every comment with same-length whitespace, preserving newlines so
 * line numbers survive. String-aware, so a `//` inside a string literal is not
 * mistaken for a comment. Covers TypeScript and Go: both use `//` and `/* *\/`,
 * and Go's raw backtick strings behave like a template literal for this purpose
 * (no escapes, but treating `\` as an escape inside one cannot swallow the
 * closing backtick of any string in this tree, and the selftest pins that).
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      for (let k = i; k < stop; k++) out += text[k] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (quote !== "`" && text[i] === "\\") {
          out += text[i] + (text[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += text[i];
        if (text[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// --------------------------------------------------------------------------
// Report-site extraction
// --------------------------------------------------------------------------

// A string literal whose ENTIRE content is a diagnostic code.
const EXACT_CODE_STRING_RE = /(["'])(SMITHERS[0-9]{4})\1/g;
// The same, for a fork file that constructs a code from a bare digit suffix.
// Bare digits are ambiguous on their own, so this one IS a positive shape list:
// an argument position, or the `suffix:` table field that feeds one.
const BARE_SUFFIX_RE = /(?:\bsuffix\s*:\s*|[(,]\s*)(["'])([0-9]{4})\1/g;
// `= "SMITHERS"` with no digits: a diagnostic-code prefix constant.
const PREFIX_CONST_RE = /=\s*"SMITHERS"/;
// The two positions that NAME a code without reporting one.
const COMPARISON_BEFORE_RE = /[=!]==?\s*$/;
const UNION_MEMBER_RE = /\|\s*$/;

/**
 * Every code this source text REPORTS, plus every code it merely MENTIONS
 * outside a comment. The second set is the audit residual: it is what this
 * method drops, kept so nothing is discarded silently.
 */
export function extractFromSource(text, { constructsCodes = false } = {}) {
  const stripped = stripComments(text);
  const reported = new Set();
  const namedNotReported = new Set();

  for (const match of stripped.matchAll(EXACT_CODE_STRING_RE)) {
    const before = stripped.slice(Math.max(0, match.index - 24), match.index);
    const after = stripped.slice(match.index + match[0].length, match.index + match[0].length + 24);
    // `diagnostic.code === "SMITHERS1151"` filters on a code; it does not report one.
    // `"SMITHERS6001" | "SMITHERS6002"` declares the code space; it does not report one.
    if (COMPARISON_BEFORE_RE.test(before) || UNION_MEMBER_RE.test(before) || /^\s*\|/.test(after)) {
      namedNotReported.add(match[2]);
      continue;
    }
    reported.add(match[2]);
  }

  if (constructsCodes) {
    for (const match of stripped.matchAll(BARE_SUFFIX_RE)) {
      reported.add("SMITHERS" + match[2]);
    }
  }

  // The residual is taken from the RAW text, not the stripped text, on purpose.
  // `stripComments` is hand-rolled and string-aware, so its failure mode is a
  // quote it mis-pairs — a regex literal holding an apostrophe, say — which would
  // blank the rest of a file and drop real report sites in silence. Diffing
  // against the raw text means anything lost that way surfaces in the residual
  // instead of vanishing, and `subtraction` prints the residual on every run.
  const mentionedOutsideComments = new Set(
    [...(text.match(CODE_RE) ?? []), ...namedNotReported].filter((code) => !reported.has(code)),
  );
  return { reported, mentionedOutsideComments };
}

// --------------------------------------------------------------------------
// File selection
// --------------------------------------------------------------------------

// Deliberately short. `poc/src/build/` is real reference source — it reports
// the whole SMITHERS52xx asset family — so a plausible-looking "build" skip here
// silently removed SMITHERS5201/5207 from R while this script was being written.
// The audit residual caught it; a wider skip list would have hidden it.
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const isTestFile = (file) =>
  /\.test\.[cm]?[jt]sx?$/.test(file) ||
  /\.spec\.[cm]?[jt]sx?$/.test(file) ||
  /_test\.go(\.txt)?$/.test(file);

/** Reference implementation sources: the TypeScript the reference compiler is. */
export function referenceFiles() {
  return [path.join(ROOT, "poc/src"), path.join(ROOT, "src")]
    .flatMap((dir) => walk(dir))
    .filter((file) => /\.[cm]?tsx?$/.test(file) && !isTestFile(file))
    .sort();
}

/** Fork implementation sources: the Go, and the `.go.txt` bridge templates. */
export function forkFiles() {
  return walk(path.join(ROOT, "compiler"))
    .filter((file) => (/\.go$/.test(file) || /\.go\.txt$/.test(file)) && !isTestFile(file))
    .sort();
}

// --------------------------------------------------------------------------
// The three halves
// --------------------------------------------------------------------------

function censusOver(files) {
  const reported = new Set();
  const residual = new Map(); // code -> [file:line, ...]
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const constructsCodes = PREFIX_CONST_RE.test(stripComments(text));
    const result = extractFromSource(text, { constructsCodes });
    for (const code of result.reported) reported.add(code);
    for (const code of result.mentionedOutsideComments) {
      if (!residual.has(code)) residual.set(code, []);
      residual.get(code).push(path.relative(ROOT, file));
    }
  }
  // A code reported anywhere is not a residual anywhere.
  for (const code of reported) residual.delete(code);
  return { reported, residual };
}

export const referenceCensus = () => censusOver(referenceFiles());
export const forkCensus = () => censusOver(forkFiles());

/** Codes the corpus DECLARES, parsed from the expectations rather than grepped. */
export function corpusCodes(dir = path.join(ROOT, "conformance/corpus")) {
  const codes = new Set();
  for (const file of walk(dir)) {
    if (!file.endsWith(".expected.json")) continue;
    const expectation = JSON.parse(readFileSync(file, "utf8"));
    for (const diagnostic of expectation.diagnostics ?? []) {
      if (typeof diagnostic.code === "string") codes.add(diagnostic.code);
    }
  }
  return codes;
}

/**
 * The old method, kept so the page can print the DIFF rather than the totals:
 * a bare literal-code grep over whole directories, prose and tests included.
 */
export function mentionCensus(roots, extensions) {
  const codes = new Set();
  for (const root of roots) {
    for (const file of walk(path.join(ROOT, root))) {
      if (extensions && !extensions.some((ext) => file.endsWith(ext))) continue;
      for (const code of readFileSync(file, "utf8").match(CODE_RE) ?? []) codes.add(code);
    }
  }
  return codes;
}

/**
 * The reference must not construct codes the way the fork does, or this
 * script would undercount it exactly as the old command undercounted the fork.
 * Asserted on every run rather than believed.
 */
export function assertNoUndetectedConstruction() {
  const offenders = referenceFiles().filter((file) =>
    PREFIX_CONST_RE.test(stripComments(readFileSync(file, "utf8"))),
  );
  if (offenders.length !== 0) {
    throw new Error(
      "the reference now constructs diagnostic codes from a prefix constant, so this census " +
        "undercounts it; teach censusOver about it: " +
        offenders.map((f) => path.relative(ROOT, f)).join(", "),
    );
  }
}

const sorted = (set) => [...set].sort();
const minus = (a, b) => sorted(a).filter((x) => !b.has(x));
const intersect = (a, b) => sorted(a).filter((x) => b.has(x));

export function derive() {
  assertNoUndetectedConstruction();
  const reference = referenceCensus();
  const fork = forkCensus();
  const corpusAll = corpusCodes();
  const corpus = new Set(sorted(corpusAll).filter((c) => c.startsWith("SMITHERS")));
  const both = new Set(intersect(reference.reported, fork.reported));
  return {
    reference,
    fork,
    corpus,
    corpusAll,
    both,
    referenceOnly: minus(reference.reported, fork.reported),
    forkOnly: minus(fork.reported, reference.reported),
    declaredOutsideIntersection: minus(corpus, both),
    inBothNoCase: minus(both, corpus),
  };
}

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------

function printList(label, list) {
  console.log(`${label} (${list.length})`);
  for (let i = 0; i < list.length; i += 6) console.log("  " + list.slice(i, i + 6).join(" "));
}

function main(argv) {
  const command = argv[0] ?? "subtraction";
  if (command === "reference") return void console.log(sorted(referenceCensus().reported).join("\n"));
  if (command === "fork") return void console.log(sorted(forkCensus().reported).join("\n"));
  if (command === "corpus") return void console.log(sorted(corpusCodes()).join("\n"));

  if (command === "shapes") {
    // The evidence for the report-site rule: every occurrence it accepts, with
    // the 45 characters in front of it, most common first.
    const shapes = new Map();
    for (const file of [...referenceFiles(), ...forkFiles()]) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const match of stripped.matchAll(REPORT_SITE_RE)) {
        const key = stripped.slice(Math.max(0, match.index - 45), match.index).replace(/\s+/g, " ");
        shapes.set(key, (shapes.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of [...shapes].sort((a, b) => b[1] - a[1])) {
      console.log(String(count).padStart(4), JSON.stringify(key));
    }
    return;
  }

  if (command === "selftest") return void selftest();

  const d = derive();
  // The two published commands, replicated exactly: a bare literal-code grep over
  // whole directories with no extension filter, prose and tests included.
  //   grep -roh 'SMITHERS[0-9]\{4\}' poc/src src | sort -u
  //   grep -roh 'SMITHERS[0-9]\{4\}' compiler/  | sort -u   (+ two constructed-code greps)
  const oldReference = mentionCensus(["poc/src", "src"]);
  const oldFork = mentionCensus(["compiler"]);
  for (const file of [path.join(ROOT, "compiler/forkbridge/durable.go.txt")]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/durableCode\("([0-9]{4})"\)/g)) oldFork.add("SMITHERS" + m[1]);
    for (const m of text.matchAll(/fail\([^,]*, *"([0-9]{4})"/g)) oldFork.add("SMITHERS" + m[1]);
  }

  console.log("# COVERAGE.md derivation — report sites, not mentions");
  console.log(`R (reference reports) = ${d.reference.reported.size}`);
  console.log(`F (fork reports)      = ${d.fork.reported.size}`);
  console.log(`C (corpus declares)   = ${d.corpus.size}   [SMITHERS family; ${d.corpusAll.size} across all families]`);
  console.log(`B (in both)           = ${d.both.size}`);
  console.log(`declared outside B    = ${d.declaredOutsideIntersection.length === 0 ? "NONE" : d.declaredOutsideIntersection.join(" ")}`);
  console.log(`SUBTRACTION (in both, no case) = ${d.inBothNoCase.length}`);
  console.log("");
  printList("in both implementations and in no case", d.inBothNoCase);
  printList("reference-only", d.referenceOnly);
  printList("fork-only", d.forkOnly);
  console.log("");
  console.log("## What the old mention-counting method got wrong");
  printList("counted by the OLD reference grep, reported NOWHERE", minus(oldReference, d.reference.reported));
  printList("counted by the OLD fork grep, reported NOWHERE", minus(oldFork, d.fork.reported));
  printList("MISSED by the OLD fork grep (constructed codes)", minus(d.fork.reported, oldFork));
  printList("MISSED by the OLD reference grep", minus(d.reference.reported, oldReference));
  console.log("");
  console.log("## Residual — survives comment-stripping, reaches no report site");
  console.log("   (each is a claim to audit; none is counted above)");
  for (const [code, files] of [...d.reference.residual].sort()) {
    console.log(`  reference ${code}: ${[...new Set(files)].join(", ")}`);
  }
  for (const [code, files] of [...d.fork.residual].sort()) {
    console.log(`  fork      ${code}: ${[...new Set(files)].join(", ")}`);
  }
}

// --------------------------------------------------------------------------
// Selftest — the fixture the extractor must not regress past
// --------------------------------------------------------------------------

export const FIXTURE_DIR = path.join(ROOT, "scripts/coverage-codes-fixture");

/**
 * Runs the extractor over the fixture and returns what it found, so both the
 * CLI and `test/coverage-codes.test.mjs` assert the same thing.
 */
export function fixtureCensus() {
  const files = walk(FIXTURE_DIR).filter(
    (file) => (/\.[cm]?tsx?$/.test(file) || /\.go(\.txt)?$/.test(file)) && !isTestFile(file),
  );
  const skipped = walk(FIXTURE_DIR).filter((file) => !files.includes(file));
  const reported = new Set();
  const residual = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const result = extractFromSource(text, {
      constructsCodes: PREFIX_CONST_RE.test(stripComments(text)),
    });
    for (const code of result.reported) reported.add(code);
    for (const code of result.mentionedOutsideComments) residual.add(code);
  }
  for (const code of reported) residual.delete(code);
  return { reported, residual, files, skipped };
}

/** Every code the fixture REPORTS, and must therefore be counted. */
export const FIXTURE_REPORTED = [
  "SMITHERS9001", // ts: code: property
  "SMITHERS9002", // ts: argument to a report helper
  "SMITHERS9003", // ts: argument to a helper across a line break
  "SMITHERS9004", // ts: single-quoted argument
  "SMITHERS9005", // go: Code: struct field
  "SMITHERS9006", // go: argument to a.report(...)
  "SMITHERS9007", // go: constructed from a bare suffix via durableCode(...)
  "SMITHERS9008", // go: constructed from a bare suffix via d.fail(node, "...", ...)
  "SMITHERS9009", // go: constructed from a `suffix:` table field
];

/**
 * Every code the fixture only MENTIONS. Each line is one shape that fooled the
 * old method in this repository, with the real code it stood in for. If any of
 * these is ever counted, the extractor has regressed to counting mentions.
 */
export const FIXTURE_MENTIONED_ONLY = [
  "SMITHERS9101", // a line comment saying the rule is withdrawn      (was 4106/4107)
  "SMITHERS9102", // a block/JSDoc comment describing another backend (was 1105)
  "SMITHERS9103", // a comment recording the rule's retirement, and the same code
  //                 named inside a longer string                     (was 1805/1807)
  "SMITHERS9104", // a design-document sentence in markdown           (was 1708)
  "SMITHERS9105", // a Go test file's comment AND its Code: field     (was 4121)
  "SMITHERS9106", // a Go test file's live assertion string, literal and
  //                 constructed-from-a-bare-suffix                   (was 4117)
  "SMITHERS9107", // an equality comparison in a consumer, not a producer
  "SMITHERS9108", // a TypeScript test file's live assertion string
  "SMITHERS9109", // a type-union member declaring the code space (union head)
  "SMITHERS9110", // a type-union member declaring the code space
  "SMITHERS9111", // a type-union member declaring the code space (union tail)
  "SMITHERS9112", // a comment QUOTING a code in full report shape — the shape
  //                 that makes comment-stripping load-bearing on its own
];

function selftest() {
  const { reported, residual, files, skipped } = fixtureCensus();
  const problems = [];
  if (files.length === 0) problems.push("the fixture matched no files at all");

  for (const code of FIXTURE_REPORTED) {
    if (!reported.has(code)) problems.push(`${code} is a REPORT site and was not counted`);
  }
  for (const code of FIXTURE_MENTIONED_ONLY) {
    if (reported.has(code)) {
      problems.push(`${code} is only MENTIONED and was counted — the extractor counts mentions again`);
    }
  }
  const unexpected = [...reported].filter((c) => !FIXTURE_REPORTED.includes(c));
  if (unexpected.length !== 0) problems.push(`counted codes the fixture does not report: ${unexpected.join(" ")}`);

  // The mention shapes that live in files the census reads must show up in the
  // residual, not vanish: anything dropped has to stay auditable.
  for (const code of ["SMITHERS9101", "SMITHERS9102", "SMITHERS9103", "SMITHERS9107", "SMITHERS9109"]) {
    if (code === "SMITHERS9107" || code === "SMITHERS9109") {
      if (!residual.has(code)) problems.push(`${code} was dropped without landing in the audit residual`);
    }
  }

  if (problems.length !== 0) {
    for (const problem of problems) console.error("FAIL " + problem);
    process.exitCode = 1;
    return { ok: false, problems };
  }
  console.log(
    `ok — ${FIXTURE_REPORTED.length} report sites counted, ${FIXTURE_MENTIONED_ONLY.length} mention shapes rejected, ` +
      `over ${files.length} fixture files (${skipped.length} skipped as tests or prose)`,
  );
  return { ok: true, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
