#!/usr/bin/env node
/**
 * The product-vs-oracle differential gate.
 *
 * ## Why this exists
 *
 * `conformance/runner/run.mjs` measures two BACKENDS against the corpus. Neither
 * of them is the shipped product. The JS reference backend reaches the frontend
 * through its own driver (`conformance/runner/js-lower.mjs`), which turns the
 * source-asset stage on only for a case that ships assets, skips the comptime
 * frontend for a case with no compiler-owned edge, and runs a durable source
 * pass of its own before compiling. `bin/smithers.js` does none of those three
 * things in that order: it runs an asset preflight and a runtime-graph resolver
 * over every `.sm` before the semantic stage, runs comptime unconditionally, and
 * has no durable stage in `check`/`run` at all.
 *
 * So "424 cases, 0 divergent" was never a statement about `smithers`. It was a
 * statement about `compileProject` plus `js-lower.mjs`. The corpus is quoted as
 * the language contract; before this gate, nothing measured how much of that
 * contract the thing users actually run can deliver, and the answer could drift
 * further every week without a single red square anywhere.
 *
 * ## What it measures
 *
 * Every corpus case, staged byte-for-byte the way `conformance/runner/backend-js.mjs`
 * stages it, handed to `node bin/smithers.js check <entry> --format json`, and
 * judged against the case's declared expectation using the corpus's OWN equality
 * relation (`conformance/runner/judge.mjs`: diagnostic code plus 1-based authored
 * line and column, as a sorted multiset).
 *
 * A case whose expectation is `output` is required only to be ACCEPTED here.
 * `smithers run` executes an emitted module directly and never calls the
 * `main()` the conformance harness calls, so this gate deliberately does not
 * claim to compare printed output; the harness still owns that half. Acceptance
 * is the half a product-vs-oracle differential can honestly measure, and it is
 * the half that catches "the oracle certifies a program the product cannot
 * process at all".
 *
 * ## Why a baseline instead of a red gate
 *
 * The divergence is real, it is 47 cases wide, and most of its root causes live
 * in `poc/src/**` or need a decision from the ledger owner (see the `verdict`
 * and `cause` fields of every row in `conformance/product-divergence.json`).
 * Failing the build on all of it today would mean disabling the gate tomorrow.
 * So the divergence is WRITTEN DOWN, per case, with which side is wrong, and
 * this gate fails when the written-down set stops matching the measured one — in
 * EITHER direction:
 *
 *   - a case that diverges and is not in the baseline is a NEW divergence, and
 *     the product just lost ground the corpus still claims;
 *   - a case in the baseline that no longer diverges is a FIXED divergence whose
 *     row must be deleted, so the file cannot rot into a list of things that
 *     used to be broken;
 *   - a case whose divergence CHANGED SHAPE is reported as both, because a
 *     different wrong answer is a different defect.
 *
 * ## Usage
 *
 *   node scripts/oracle-differential.mjs                # gate: exit 0 iff measured == baseline
 *   node scripts/oracle-differential.mjs --jobs 8       # parallelism (default 4)
 *   node scripts/oracle-differential.mjs --filter 17-   # measure a subset (never gates)
 *   node scripts/oracle-differential.mjs --update       # rewrite the baseline, then REVIEW THE DIFF
 *
 * `--update` preserves the `verdict`, `cause` and `note` of every row it can
 * match by id, so re-measuring never silently discards a per-case judgement.
 * A row it cannot match is written with `verdict: "unreviewed"`, which the gate
 * itself refuses, so a regenerated baseline cannot pass unread.
 *
 * The gate spawns one `node` per case and takes a few minutes. It is not part of
 * `npm test`; run it after any change to `src/**`, `conformance/runner/**`, or
 * the frontend stages the CLI drives.
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

import { loadCorpus, repositoryRoot } from "../conformance/runner/corpus.mjs";

const CLI = join(repositoryRoot, "bin", "smithers.js");
const BASELINE = join(repositoryRoot, "conformance", "product-divergence.json");

/** The verdicts a baseline row may carry. `unreviewed` never passes the gate. */
export const VERDICTS = Object.freeze([
  // The corpus states the contract correctly and the shipped CLI cannot deliver it.
  "product-wrong",
  // The corpus pins something the product is right to refuse or to spell differently.
  "corpus-wrong",
  // The two disagree because a locked decision is contradicted by one of them;
  // the decisions ledger owner has to settle it before either side may move.
  "decision-needed",
  // Written by `--update` for a row it could not match. Refused by the gate.
  "unreviewed",
]);

/**
 * Render one CLI answer as a stable, path-free string.
 *
 * Every absolute path is replaced by the staged file's project-relative name, so
 * the same divergence produces the same text from any staging root, on any
 * machine. This is what makes the baseline comparable rather than a transcript.
 */
function normalize(text, directory) {
  return String(text ?? "")
    .split(directory + "/").join("")
    .split(directory).join("<project>")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function diagnosticKey(diagnostic, directory, entry) {
  const file = diagnostic.file ? relative(directory, resolve(diagnostic.file)) : undefined;
  // The corpus relation does not pin a file, so a diagnostic in the authored
  // entry prints as `CODE@line:column` exactly as `judge.mjs` prints it. One
  // anywhere ELSE prints its file too: same code and line in a different module
  // is a different program point, and a differential that hid that would be
  // agreeing with itself.
  return file === undefined || file === entry
    ? `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`
    : `${diagnostic.code}@${file}:${diagnostic.line}:${diagnostic.column}`;
}

function sortKeys(keys) {
  return [...keys].sort();
}

/** The corpus's declared answer, in the same spelling the product's is rendered in. */
export function corpusAnswer(expectation) {
  if (expectation.expect === "output") return "ACCEPTED";
  return sortKeys(expectation.diagnostics.map((entry) => `${entry.code}@${entry.line}:${entry.column}`)).join(", ");
}

function productAnswer(result, directory, entry) {
  if (result.json === undefined) {
    return `NO-JSON exit ${result.status}: ${normalize(result.stdout || result.stderr, directory).slice(0, 200)}`;
  }
  const json = result.json;
  // A top-level envelope with no `files` is the CLI refusing the PROJECT rather
  // than reporting on a program: `backendFailure` in `src/cli.ts`. It carries no
  // code and no position, so it can never satisfy a corpus expectation, and the
  // message is the only thing that identifies which refusal it was.
  if (json.files === undefined) {
    return `${json.code ?? "SMITHERS_PROJECT_ERROR"}: ${normalize(json.message, directory).slice(0, 200)}`;
  }
  const diagnostics = [];
  for (const file of json.files) {
    for (const diagnostic of file.diagnostics ?? []) {
      if (diagnostic.severity === "error") diagnostics.push(diagnosticKey(diagnostic, directory, entry));
    }
  }
  for (const diagnostic of json.assets?.diagnostics ?? []) {
    if (diagnostic.severity === "error") {
      diagnostics.push(diagnosticKey({ ...diagnostic, file: diagnostic.fileName ?? diagnostic.file }, directory, entry));
    }
  }
  if (json.ok === true) return "ACCEPTED";
  if (diagnostics.length === 0) return `REFUSED-WITH-NO-DIAGNOSTIC (${json.code ?? "none"})`;
  return sortKeys(diagnostics).join(", ");
}

/**
 * Which way the disagreement points.
 *
 * `product-accepts` is the dangerous one and is named first everywhere it is
 * printed: the corpus says a program must be refused and the shipped compiler
 * compiles it, so the corpus green is certifying a rule the product does not
 * enforce. `product-refuses` means the oracle certifies a program the product
 * cannot process. `both-refuse` means the verdict agrees and the reason does
 * not, which still makes the corpus row a statement about a diagnostic no user
 * ever sees.
 */
export function classify(expectation, answer) {
  if (expectation.expect === "output") return answer === "ACCEPTED" ? undefined : "product-refuses";
  if (answer === "ACCEPTED") return "product-accepts";
  return "both-refuse";
}

async function measureCase(testCase) {
  const stageRoot = mkdtempSync(join(tmpdir(), "smithers-oracle-differential-"));
  // The staged root is realpath'd because macOS hands out `/var/...` temporary
  // directories that the CLI canonicalizes to `/private/var/...`; without this
  // every diagnostic looks like it landed in a file outside the project.
  const directory = realpathSync(stageRoot);
  try {
    for (const file of testCase.files) {
      const target = join(directory, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.text);
    }
    const result = await runCli(join(directory, testCase.entry), directory);
    const answer = productAnswer(result, directory, testCase.entry);
    const expected = corpusAnswer(testCase.expectation);
    return {
      id: testCase.id,
      area: testCase.area,
      expect: testCase.expectation.expect,
      xfail: (testCase.expectation.xfail?.backends ?? []).join("+") || undefined,
      corpus: expected,
      product: answer,
      direction: answer === expected ? undefined : classify(testCase.expectation, answer),
      agrees: answer === expected,
    };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function runCli(entry, cwd) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [CLI, "check", entry, "--format", "json"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => {
      clearTimeout(timer);
      let json;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolveResult({ status, stdout, stderr, json });
    });
  });
}

async function measureAll(cases, jobs) {
  const rows = new Array(cases.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const index = next++;
      rows[index] = await measureCase(cases[index]);
      done += 1;
      if (process.stderr.isTTY) process.stderr.write(`\r  measured ${done}/${cases.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, cases.length) }, worker));
  if (process.stderr.isTTY) process.stderr.write("\n");
  return rows;
}

function readBaseline() {
  let text;
  try {
    text = readFileSync(BASELINE, "utf8");
  } catch {
    throw new Error(`missing ${relative(repositoryRoot, BASELINE)}; regenerate it with --update and review the result`);
  }
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed?.divergences)) {
    throw new Error(`${relative(repositoryRoot, BASELINE)}: expected a "divergences" array`);
  }
  return parsed;
}

/**
 * Validate one baseline file against the live corpus without running anything.
 *
 * Exported so `conformance/runner/selftest.mjs` can gate the file's integrity in
 * milliseconds: a divergence row naming a case that no longer exists, a
 * duplicate row, or a row that was regenerated and never reviewed are all
 * defects in the record itself, and none of them need 424 subprocesses to find.
 */
export function auditBaseline(baseline, cases) {
  const violations = [];
  const known = new Set(cases.map((testCase) => testCase.id));
  const seen = new Set();
  for (const row of baseline.divergences) {
    if (typeof row?.id !== "string") {
      violations.push(`a divergence row has no id: ${JSON.stringify(row)}`);
      continue;
    }
    if (seen.has(row.id)) violations.push(`${row.id}: listed twice`);
    seen.add(row.id);
    if (!known.has(row.id)) violations.push(`${row.id}: no such corpus case (delete the row or restore the case)`);
    if (!VERDICTS.includes(row.verdict)) {
      violations.push(`${row.id}: verdict ${JSON.stringify(row.verdict)} is not one of ${VERDICTS.join(", ")}`);
    }
    if (row.verdict === "unreviewed") {
      violations.push(`${row.id}: regenerated but never reviewed; decide which side is wrong and record it`);
    }
    for (const field of ["corpus", "product", "direction", "cause"]) {
      if (typeof row[field] !== "string" || row[field].length === 0) {
        violations.push(`${row.id}: ${field} must be a non-empty string`);
      }
    }
  }
  return violations;
}

function parseArguments(argv) {
  const options = { jobs: 4, update: false, filter: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--update") options.update = true;
    else if (argument === "--jobs") options.jobs = Number(argv[++index]);
    else if (argument.startsWith("--jobs=")) options.jobs = Number(argument.slice("--jobs=".length));
    else if (argument === "--filter") options.filter = argv[++index];
    else if (argument.startsWith("--filter=")) options.filter = argument.slice("--filter=".length);
    else throw new Error(`unknown argument ${argument}`);
  }
  if (!Number.isInteger(options.jobs) || options.jobs < 1 || options.jobs > 32) {
    throw new Error("--jobs must be an integer between 1 and 32");
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const cases = loadCorpus({ filter: options.filter });
  if (cases.length === 0) throw new Error("the filter matched no corpus case");
  // The baseline is read and audited BEFORE anything is measured. A malformed
  // record is a defect in the record, and spending four hundred subprocesses to
  // discover it would make the fast failure the slow one.
  let baseline;
  if (!options.update && options.filter === undefined) {
    baseline = readBaseline();
    const violations = auditBaseline(baseline, loadCorpus({}));
    if (violations.length > 0) {
      process.stdout.write(`${relative(repositoryRoot, BASELINE)} is not a usable record:\n`);
      for (const violation of violations) process.stdout.write(`  - ${violation}\n`);
      process.exitCode = 1;
      return;
    }
  }
  process.stderr.write(`measuring ${cases.length} case(s) through bin/smithers.js check, ${options.jobs} at a time\n`);
  const rows = await measureAll(cases, options.jobs);
  const measured = rows.filter((row) => !row.agrees);

  if (options.update) {
    const previous = new Map();
    try {
      for (const row of readBaseline().divergences) previous.set(row.id, row);
    } catch { /* first generation */ }
    const divergences = measured.map((row) => {
      const prior = previous.get(row.id);
      const carried = prior && prior.corpus === row.corpus && prior.product === row.product;
      return {
        id: row.id,
        direction: row.direction,
        corpus: row.corpus,
        product: row.product,
        verdict: carried ? prior.verdict : "unreviewed",
        cause: carried ? prior.cause : "unreviewed",
        ...(carried && prior.note ? { note: prior.note } : {}),
        ...(row.xfail ? { xfailBackends: row.xfail } : {}),
      };
    });
    writeFileSync(BASELINE, `${JSON.stringify({
      schema: "smithers.product-divergence/v1",
      measuredBy: "scripts/oracle-differential.mjs",
      purpose:
        "Every corpus case where `node bin/smithers.js check` disagrees with the case's declared expectation. " +
        "The conformance runner measures two BACKENDS; neither is the shipped CLI, so this file is the written " +
        "record of how far the product is from the contract the corpus is quoted as stating. `direction` " +
        "product-accepts is the dangerous one — the corpus requires a refusal and the product compiled it. " +
        "`verdict` says which side is wrong; `decision-needed` rows may not be moved by either side until the " +
        "decisions ledger owner settles them. A row disappears when the divergence is FIXED, never when it is " +
        "tolerated.",
      total: rows.length,
      divergent: divergences.length,
      divergences,
    }, null, 2)}\n`);
    process.stdout.write(`wrote ${relative(repositoryRoot, BASELINE)}: ${divergences.length} divergence(s) of ${rows.length}\n`);
    const unreviewed = divergences.filter((row) => row.verdict === "unreviewed");
    if (unreviewed.length > 0) {
      process.stdout.write(`  ${unreviewed.length} row(s) need a verdict before the gate will pass:\n`);
      for (const row of unreviewed) process.stdout.write(`    ${row.id}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (options.filter !== undefined) {
    process.stdout.write(`${rows.length} measured, ${measured.length} divergent (filtered run; the baseline is not gated)\n`);
    for (const row of measured) {
      process.stdout.write(`\n${row.id} [${row.direction}]\n  corpus:  ${row.corpus}\n  product: ${row.product}\n`);
    }
    return;
  }

  const expected = new Map(baseline.divergences.map((row) => [row.id, row]));
  const actual = new Map(measured.map((row) => [row.id, row]));

  const added = [...actual.values()].filter((row) => !expected.has(row.id));
  const resolved = [...expected.values()].filter((row) => !actual.has(row.id));
  const changed = [...actual.values()].filter((row) => {
    const prior = expected.get(row.id);
    return prior && (prior.corpus !== row.corpus || prior.product !== row.product);
  });

  const dangerous = measured.filter((row) => row.direction === "product-accepts");
  process.stdout.write(`\nproduct-vs-oracle differential: ${rows.length} cases, ${measured.length} divergent\n`);
  process.stdout.write(`  product ACCEPTS what the corpus refuses: ${dangerous.length}\n`);
  process.stdout.write(`  product refuses what the corpus accepts: ${measured.filter((row) => row.direction === "product-refuses").length}\n`);
  process.stdout.write(`  both refuse, different code or position: ${measured.filter((row) => row.direction === "both-refuse").length}\n`);
  for (const row of dangerous) {
    process.stdout.write(`  !! ${row.id}: the corpus requires [${row.corpus}] and the product compiled it\n`);
  }

  const failures = [];
  for (const row of added) {
    failures.push(`NEW divergence ${row.id} [${row.direction}]\n    corpus:  ${row.corpus}\n    product: ${row.product}`);
  }
  for (const row of changed) {
    const prior = expected.get(row.id);
    failures.push(`CHANGED divergence ${row.id}\n    was:  ${prior.product}\n    now:  ${row.product}`);
  }
  for (const row of resolved) {
    failures.push(`FIXED divergence ${row.id} — delete its row from ${relative(repositoryRoot, BASELINE)}`);
  }

  if (failures.length === 0) {
    process.stdout.write(`\nthe measured divergence set matches ${relative(repositoryRoot, BASELINE)} exactly\n`);
    return;
  }
  process.stdout.write(`\n${failures.length} discrepancy(ies) against the recorded baseline:\n`);
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  process.exitCode = 1;
}

// Importable without side effects: `conformance/runner/selftest.mjs` gates this
// file's baseline audit and equality relation in milliseconds, and must not
// spawn four hundred compilers to do it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
