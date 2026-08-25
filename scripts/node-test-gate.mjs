#!/usr/bin/env node
/**
 * The root Node test gate.
 *
 * `node --test` counts a skipped test as a passing test and exits 0. Every
 * conditional skip in `test/` is a toolchain probe — `bun` for the JS
 * conformance harness, the pinned fork checkout and `go` for the backend
 * cases — so on a machine that is missing one of them the strongest gate in
 * `npm test` silently stops running while still printing green. That is the
 * third time this repository has shipped a gate that passes without doing its
 * work; `scripts/go-test-gate.mjs` already solved the identical problem for Go
 * with a census, and this file mirrors it.
 *
 * Mirrors, and then goes one step further. The Go gate refuses only skips
 * whose reason names the checkout, which leaves any other skip passing with
 * the census as its only trace. The root Node suite has no legitimate skip:
 * every one of its ten conditional skips removes real coverage. So the policy
 * here is that a skip — or a `todo`, which node also scores as non-failing
 * however its body behaves — is a refusal, and adding a deliberate one is a
 * deliberate change to this file. The census prints on every run, including
 * the green ones, so "skipped 0" is an assertion rather than an absence.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { repositoryRoot } from "./fork-e2e.mjs";

const CENSUS_REPORTER = new URL("./node-test-census-reporter.mjs", import.meta.url).href;

/** Discover the suite the same way `node --test test/*.test.mjs` would. */
export async function discoverTestFiles(testDirectory) {
  return (await readdir(testDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
    .map((entry) => join("test", entry.name))
    .sort();
}

function describeMarker(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "reason not reported";
}

function locate(record) {
  const file = record.file ? record.file.replace(`${repositoryRoot}/`, "") : "<unknown file>";
  return `${file}:${record.name}`;
}

/**
 * One line naming what the run actually did, printed whether or not the run is
 * about to be refused. `passed` counts only tests that ran and passed: a
 * skipped test is not a passing test and is never folded into that number.
 */
export function census(records) {
  const skipped = records.filter((record) => record.skip !== null && record.skip !== undefined);
  const todo = records.filter((record) => record.todo !== null && record.todo !== undefined);
  const marked = new Set([...skipped, ...todo]);
  const ran = records.filter((record) => !marked.has(record));
  const failed = ran.filter((record) => record.status === "fail");
  const describe = (entries) =>
    entries.length === 0
      ? "none"
      : entries
          .map((record) => `${locate(record)}: ${describeMarker(record.skip ?? record.todo)}`)
          .sort()
          .join("; ");
  return {
    failed: failed.length,
    passed: ran.length - failed.length,
    ran: ran.length,
    skipped,
    todo,
    line:
      `Node test census: ran ${ran.length} (passed ${ran.length - failed.length}, failed ${failed.length}), ` +
      `skipped ${skipped.length}, todo ${todo.length}; ` +
      `skip reasons: ${describe(skipped)}; todo reasons: ${describe(todo)}`,
  };
}

/**
 * Every reason this run may not be reported as green, as sentences. Empty means
 * the suite ran everything it claims to cover.
 */
export function coverageRefusals(records) {
  const counted = census(records);
  const refusals = [];
  if (counted.skipped.length > 0) {
    refusals.push(
      `Node test gate failed: ${counted.skipped.length} test(s) were skipped, and a skipped test is not a passing test.\n` +
        counted.skipped
          .map((record) => `  skipped ${locate(record)}: ${describeMarker(record.skip)}`)
          .sort()
          .join("\n") +
        "\nEvery skip in test/ is a missing toolchain (bun, go, or the pinned fork checkout). Remedy: install it, " +
        "or run `node scripts/prepare-typescript-fork.mjs --fetch` and apply the patch series. A skip that is " +
        "genuinely deliberate has to be allowed here, on purpose, in this file.",
    );
  }
  if (counted.todo.length > 0) {
    refusals.push(
      `Node test gate failed: ${counted.todo.length} test(s) are marked todo, which node scores as non-failing ` +
        "however the body behaves.\n" +
        counted.todo
          .map((record) => `  todo ${locate(record)}: ${describeMarker(record.todo)}`)
          .sort()
          .join("\n"),
    );
  }
  return refusals;
}

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function parseCensus(text) {
  const records = [];
  let malformed = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      malformed = true;
    }
  }
  return { malformed, records };
}

/**
 * Run one set of test files under `node --test`, keeping the human reporter on
 * stdout exactly as before and taking the census on a second reporter channel.
 */
export async function runNodeTestFiles({ testFiles, cwd = repositoryRoot, stdio = "inherit" }) {
  const workspace = await mkdtemp(join(tmpdir(), "smithers-node-test-census-"));
  const censusPath = join(workspace, "census.jsonl");
  try {
    const child = spawn(
      process.execPath,
      [
        "--test",
        // The reporter node would have chosen on its own, so the console output
        // of this gate is unchanged by the census running beside it.
        "--test-reporter",
        process.stdout.isTTY ? "spec" : "tap",
        "--test-reporter-destination",
        "stdout",
        "--test-reporter",
        CENSUS_REPORTER,
        "--test-reporter-destination",
        censusPath,
        ...testFiles,
      ],
      // `stdio` is a parameter only so this gate's own tests can drive a fixture
      // suite without its report interleaving into the outer run's stream. The
      // gate itself always inherits.
      //
      // `NODE_TEST_CONTEXT` is deliberately dropped. A process that node's test
      // runner started carries it, and a child that inherits it reports over
      // node's internal v8 channel instead of the reporters named above — which
      // would leave the census file empty and, without the empty-census
      // refusal below, hand this gate the exact silent pass it exists to stop.
      { cwd, env: childEnvironment(), stdio },
    );
    const completed = await new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let text = "";
    try {
      text = await readFile(censusPath, "utf8");
    } catch (error) {
      return { ...completed, censusUnreadable: error.message, malformed: false, records: [] };
    }
    return { ...completed, ...parseCensus(text) };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const testDirectory = join(repositoryRoot, "test");
  const testFiles = await discoverTestFiles(testDirectory);
  if (testFiles.length === 0) {
    process.stderr.write("Node test gate failed: test/ contains no *.test.mjs files.\n");
    return 1;
  }

  process.stdout.write(`Node test preflight: running ${testFiles.length} test files.\n`);
  const completed = await runNodeTestFiles({ testFiles });
  const counted = census(completed.records);
  process.stdout.write(`${counted.line}\n`);

  if (completed.error) {
    process.stderr.write(`Node test gate failed to start: ${completed.error.message}\n`);
    return 1;
  }
  if (completed.signal) {
    process.stderr.write(`Node test gate ended from signal ${completed.signal}.\n`);
    return 1;
  }
  if (completed.censusUnreadable) {
    process.stderr.write(
      `Node test gate failed: the test census could not be read (${completed.censusUnreadable}), ` +
        "so this run cannot be audited.\n",
    );
    return 1;
  }
  if (completed.malformed) {
    process.stderr.write("Node test gate failed: the test census contained a record that was not valid JSON.\n");
    return 1;
  }
  // The shape that has already shipped once: a glob that matched, a runner that
  // exited 0, and nothing executed.
  if (completed.records.length === 0) {
    process.stderr.write(`Node test gate failed: no Node tests ran across ${testFiles.length} test file(s).\n`);
    return 1;
  }
  const refusals = coverageRefusals(completed.records);
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
      process.stderr.write(`Node test gate failed: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
