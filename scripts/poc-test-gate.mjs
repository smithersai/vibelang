#!/usr/bin/env node
/**
 * The runtime (`poc/`) test gate.
 *
 * Two problems, one file.
 *
 * The first is that until this gate existed the 2249-test runtime suite was
 * reachable from **no npm script at all**. `check`, `test`, `release:verify`
 * and `prepack` all run the Node suite and the Go suite; `bun test` appeared in
 * exactly one place in the repository, `poc/package.json`'s own `test` script,
 * which nothing calls. The ~60k lines under `poc/src/{durable,concurrency,
 * agent,data,schema,platform,build}` — leasing, fencing, the recording Proxy,
 * the schema derivations, the sandbox protocol — were covered only by a suite
 * somebody had to remember to run by hand. That is the third instance of one
 * class in this repository: `--backend both` once returned exit 0 no matter how
 * many Go cases failed, and `conformance/runner/selftest.mjs` passed while no
 * gate ran it.
 *
 * The second is sharper, and is why this is a gate rather than one more line in
 * the `test` script. `bun test` prints `1 skip` and exits **0**, and before this
 * file nothing read that number. `scripts/node-test-gate.mjs` refuses any skip
 * or `todo`; `scripts/go-test-gate.mjs` refuses skips whose reason names the
 * pinned checkout. Both print a census on every run, green ones included, so
 * "skipped 0" is an assertion rather than an absence. The runtime suite had
 * neither, so a `test.skip` added anywhere in its 114 files would have kept it
 * green and left no trace.
 *
 * Three shapes are refused here that `bun test`'s own exit code does not see:
 *
 *  - **a skip**, unless it is the one named allowance below, in the same shape
 *    as the Go gate's named checkout allowance;
 *  - **a `todo`**, which bun scores as non-failing however the body behaves
 *    (measured: a `test.todo` with a body asserting `1 === 2` prints as a todo
 *    and the run exits 0);
 *  - **a `test.only` / `it.only` / `describe.only` marker in the source**. This
 *    one is not visible in the report at all: measured on bun 1.2.20, a file
 *    containing one `test.only` runs that test and *silently drops its two
 *    siblings* — no skip marker, no census entry, they simply are not in the
 *    JUnit output — while sibling files run in full and the suite exits 0. The
 *    `--only` flag is off by default, but a source marker turns the filter on
 *    per file regardless, so the source is the only place it can be seen.
 *
 * And one more, which is the "a file stopped contributing" shape: every test
 * file discovered on disk must appear in the report, and every file in the
 * report must have been discovered. A file that fails to import, or whose tests
 * all vanish, is named rather than subtracted.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { repositoryRoot } from "./fork-e2e.mjs";

/**
 * Per-test timeout, declared rather than inherited.
 *
 * `bun test` defaults to 5000ms when `--timeout` is omitted. An omitted flag
 * whose implicit default is also a legal value is the shape this repository has
 * recorded as a fail-open three times now (`LoweringMode`'s empty string,
 * `conformance/runner/selftest.mjs` under no gate, `go test`'s implicit 10m),
 * so the budget is written down.
 *
 * It is written down *generously*. Measured on 2026-08-27 the slowest test in
 * the suite is 15.7s (`src/language/host-global-allowlist.test.ts`), which
 * passes under the 5000ms default only because bun cannot preempt synchronous
 * work — and the slowest test that bun's clock *can* see is 4.94s, 60ms of
 * headroom. Tuning a test to the clock rather than to what it proves is the
 * failure this budget exists to prevent, and this repository already knows the
 * root suite is flaky under concurrent load. 60s is still a real limit: a
 * genuine hang fails the gate instead of hanging CI forever.
 */
const BUN_TEST_TIMEOUT_MS = 60_000;

/**
 * The one skip this gate allows, named — not counted.
 *
 * `examples/agent/anthropic-model.test.ts` gates a real Anthropic API call on
 * `SMITHERS_LIVE_MODEL`, so on a machine without a credential it is a genuine
 * exclusion rather than lost coverage. It is allowed, not required: with
 * `SMITHERS_LIVE_MODEL=1` set the test runs and the census reports zero skips,
 * which is also green. Any other skip, anywhere, is a refusal.
 */
const ALLOWED_SKIPS = [
  {
    file: "examples/agent/anthropic-model.test.ts",
    name: /SMITHERS_LIVE_MODEL/u,
    why: "a real network call to the Anthropic API, gated on SMITHERS_LIVE_MODEL",
  },
];

/** Bun's own test-file discovery rule, so this gate censuses the set bun runs. */
const TEST_FILE = /(?:\.|_)(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/u;
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git"]);

/** `test.only` and friends, which filter a file's run without leaving a report entry. */
const ONLY_MARKER = /\b(?:test|it|describe)\s*\.\s*only\s*[(<]/gu;

export async function discoverPocTestFiles(pocDirectory) {
  const found = [];
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(directory, entry.name));
      } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
        found.push(relative(pocDirectory, join(directory, entry.name)));
      }
    }
  };
  await walk(pocDirectory);
  return found.sort();
}

/**
 * Every `.only` marker in the given files, as `file:line`.
 *
 * Read from the source because the report cannot show it: the tests such a
 * marker suppresses are absent from the JUnit output entirely, not marked
 * skipped in it.
 */
export async function onlyMarkers(pocDirectory, testFiles) {
  const markers = [];
  for (const file of testFiles) {
    const text = await readFile(join(pocDirectory, file), "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      ONLY_MARKER.lastIndex = 0;
      if (ONLY_MARKER.test(lines[index])) markers.push(`${file}:${index + 1}: ${lines[index].trim()}`);
    }
  }
  return markers.sort();
}

function unescapeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attributes(text) {
  const parsed = {};
  for (const match of text.matchAll(/([\w:-]+)="([^"]*)"/gu)) parsed[match[1]] = unescapeXml(match[2]);
  return parsed;
}

/**
 * Bun's JUnit report, reduced to one record per test.
 *
 * `<skipped />` is a skip and `<skipped message="TODO" />` is a todo — bun
 * spells both with the same element, and collapsing them would hide exactly the
 * distinction the node gate reports separately.
 */
export function parseJUnit(xml) {
  const records = [];
  const suite = /<testsuites\b([^>]*)>/u.exec(xml);
  const declared = suite ? Number.parseInt(attributes(suite[1]).tests ?? "", 10) : Number.NaN;
  let open;
  for (const match of xml.matchAll(/<(\/?)(testcase|skipped|failure|error)\b([^>]*?)(\/?)>/gu)) {
    const [, closing, tag, rawAttributes, selfClosing] = match;
    if (tag === "testcase") {
      if (closing) {
        if (open) records.push(open);
        open = undefined;
        continue;
      }
      if (open) records.push(open);
      const parsed = attributes(rawAttributes);
      open = {
        file: parsed.file ?? "<unknown file>",
        line: parsed.line ?? "?",
        name: parsed.name ?? "<unnamed>",
        status: "pass",
      };
      if (selfClosing) {
        records.push(open);
        open = undefined;
      }
      continue;
    }
    if (closing || !open) continue;
    if (tag === "skipped") open.status = attributes(rawAttributes).message === "TODO" ? "todo" : "skip";
    else open.status = "fail";
  }
  if (open) records.push(open);
  return { declared, records };
}

function locate(record) {
  return `${record.file}:${record.line}: ${record.name}`;
}

function isAllowed(record) {
  return ALLOWED_SKIPS.some((allowed) => allowed.file === record.file && allowed.name.test(record.name));
}

/**
 * One line naming what the run actually did, printed whether or not the run is
 * about to be refused. A skipped test is never folded into `passed`.
 */
export function census(records) {
  const skipped = records.filter((record) => record.status === "skip");
  const todo = records.filter((record) => record.status === "todo");
  const failed = records.filter((record) => record.status === "fail");
  const passed = records.filter((record) => record.status === "pass");
  const describe = (entries) => (entries.length === 0 ? "none" : entries.map(locate).sort().join("; "));
  return {
    failed: failed.length,
    files: new Set(records.map((record) => record.file)),
    passed: passed.length,
    ran: passed.length + failed.length,
    skipped,
    todo,
    line:
      `Poc test census: ran ${passed.length + failed.length} ` +
      `(passed ${passed.length}, failed ${failed.length}), ` +
      `skipped ${skipped.length}, todo ${todo.length}, across ${new Set(records.map((r) => r.file)).size} file(s); ` +
      `skip reasons: ${describe(skipped)}; todo reasons: ${describe(todo)}`,
  };
}

/**
 * Every reason this run may not be reported as green, as sentences. Empty means
 * the suite ran everything it claims to cover.
 */
export function coverageRefusals(records, { discoveredFiles = undefined, markers = [] } = {}) {
  const counted = census(records);
  const refusals = [];
  const disallowed = counted.skipped.filter((record) => !isAllowed(record));
  if (disallowed.length > 0) {
    refusals.push(
      `Poc test gate failed: ${disallowed.length} test(s) were skipped, and a skipped test is not a passing test.\n` +
        disallowed.map((record) => `  skipped ${locate(record)}`).sort().join("\n") +
        "\nThe only allowance is " +
        ALLOWED_SKIPS.map((allowed) => `${allowed.file} (${allowed.why})`).join(", ") +
        ". A skip that is genuinely deliberate has to be named here, on purpose, in this file.",
    );
  }
  if (counted.todo.length > 0) {
    refusals.push(
      `Poc test gate failed: ${counted.todo.length} test(s) are marked todo, which bun scores as non-failing ` +
        "however the body behaves.\n" +
        counted.todo.map((record) => `  todo ${locate(record)}`).sort().join("\n"),
    );
  }
  if (markers.length > 0) {
    refusals.push(
      `Poc test gate failed: ${markers.length} .only marker(s) are present, and a file containing one runs that ` +
        "test and silently drops its siblings — they do not appear in the report as skipped, they do not appear " +
        "at all.\n" +
        markers.map((marker) => `  only ${marker}`).join("\n"),
    );
  }
  if (discoveredFiles) {
    const reported = counted.files;
    const silent = discoveredFiles.filter((file) => !reported.has(file));
    if (silent.length > 0) {
      refusals.push(
        `Poc test gate failed: ${silent.length} discovered test file(s) contributed no test to the report.\n` +
          silent.map((file) => `  contributed nothing: ${file}`).join("\n") +
          "\nA file that fails to import, or whose tests all disappeared, must be named rather than subtracted.",
      );
    }
    const unexpected = [...reported].filter((file) => !discoveredFiles.includes(file));
    if (unexpected.length > 0) {
      refusals.push(
        `Poc test gate failed: the report names ${unexpected.length} file(s) this gate did not discover, so its ` +
          "census does not describe the run.\n" +
          unexpected.map((file) => `  undiscovered: ${file}`).sort().join("\n"),
      );
    }
  }
  return refusals;
}

/**
 * Run the runtime suite under bun, keeping bun's human report on stdout exactly
 * as `cd poc && bun test` prints it, and taking the census from a JUnit report
 * written to a fresh temporary file. Fresh, not a fixed path: a stale report
 * left by an earlier run is itself a way for a gate to pass without working.
 */
export async function runPocTests({ cwd, bunCommand = "bun", patterns = [], stdio = "inherit" }) {
  const workspace = await mkdtemp(join(tmpdir(), "smithers-poc-test-gate-"));
  const reportPath = join(workspace, "report.xml");
  try {
    const child = spawn(
      bunCommand,
      [
        "test",
        `--timeout=${BUN_TEST_TIMEOUT_MS}`,
        "--reporter=junit",
        `--reporter-outfile=${reportPath}`,
        // `--only` and `--bail` are deliberately not passed: both would reduce
        // what runs, and this gate exists to refuse exactly that.
        ...patterns,
      ],
      { cwd, env: process.env, stdio },
    );
    const completed = await new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let xml = "";
    try {
      xml = await readFile(reportPath, "utf8");
    } catch (error) {
      return { ...completed, declared: Number.NaN, records: [], reportUnreadable: error.message };
    }
    return { ...completed, ...parseJUnit(xml) };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const pocDirectory = join(repositoryRoot, "poc");
  const discovered = await discoverPocTestFiles(pocDirectory);
  if (discovered.length === 0) {
    process.stderr.write("Poc test gate failed: poc/ contains no test files.\n");
    return 1;
  }
  const markers = await onlyMarkers(pocDirectory, discovered);

  process.stdout.write(`Poc test preflight: running ${discovered.length} test files under bun in poc/.\n`);
  const completed = await runPocTests({ cwd: pocDirectory });

  if (completed.error) {
    const missing = completed.error.code === "ENOENT";
    process.stderr.write(
      `Poc test gate failed to start: ${completed.error.message}\n` +
        (missing ? "Remedy: install bun (https://bun.sh); the runtime suite is bun-only and is not optional.\n" : ""),
    );
    return 1;
  }

  const counted = census(completed.records);
  process.stdout.write(`${counted.line}\n`);

  if (completed.signal) {
    process.stderr.write(`Poc test gate ended from signal ${completed.signal}.\n`);
    return 1;
  }
  if (completed.reportUnreadable) {
    process.stderr.write(
      `Poc test gate failed: the JUnit report could not be read (${completed.reportUnreadable}), ` +
        "so this run cannot be audited.\n",
    );
    return 1;
  }
  // The shape that has already shipped here: a runner that exited 0 and nothing
  // executed.
  if (completed.records.length === 0) {
    process.stderr.write(`Poc test gate failed: no tests ran across ${discovered.length} test file(s).\n`);
    return 1;
  }
  if (!Number.isSafeInteger(completed.declared) || completed.declared !== completed.records.length) {
    process.stderr.write(
      `Poc test gate failed: the report declares ${completed.declared} test(s) but carries ` +
        `${completed.records.length} test record(s), so it is truncated or malformed and cannot be audited.\n`,
    );
    return 1;
  }
  const refusals = coverageRefusals(completed.records, { discoveredFiles: discovered, markers });
  for (const refusal of refusals) process.stderr.write(`${refusal}\n`);
  if (refusals.length > 0) return 1;
  if (completed.code !== 0 || counted.failed > 0) return completed.code || 1;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Poc test gate failed: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
