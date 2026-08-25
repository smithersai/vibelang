#!/usr/bin/env node
/**
 * Smithers differential conformance runner.
 *
 * Three modes, all over the same corpus:
 *
 *   --backend js     run the JS instrument only (the reference; a real gate)
 *   --backend go     run the pinned Go fork only (the migration target)
 *   --backend both   run both and diff them (default)
 *
 * Usage:
 *   node conformance/runner/run.mjs [options]
 *
 *   --backend <js|go|both>  which backends to run (default both)
 *   --filter <substring>    only cases whose id contains the substring
 *   --interop               also run the plain-TypeScript interop spot-check
 *   --only-interop          run only the interop spot-check
 *   --json                  emit the machine-readable report instead of a table
 *   --jobs <n>              parallel cases per backend (default 6 js / 4 go)
 *   --quiet                 print only the summary lines
 *   --report-only           always exit 0 for a *verdict* failure
 *   --fork-checkout <dir>   pinned smithersai/TypeScript checkout
 *
 * Exit code: non-zero when a backend the caller asked to gate on has failures.
 * The Go backend never sets a non-zero exit on its own while `--backend both`
 * is in use: the migration's baseline is a measurement, not a gate.
 *
 * Three things are NOT verdicts and are never suppressed by `--report-only`,
 * because each of them means the numbers printed cannot be trusted:
 *
 *   exit 3  a harness-integrity failure — a verdict that was not backed by the
 *           checks it claims (see `auditVerdict`), or a summary whose counts do
 *           not add up to the rows that were rendered
 *   exit 2  a case the harness could not measure at all, or a backend that was
 *           asked for and could not be prepared
 *
 * That separation is deliberate. A missing check and a crashed backend both
 * *raise* a score if they are quietly absorbed into an existing bucket, so they
 * get their own bucket and their own exit code.
 */

import { loadCorpus, loadInterop } from "./corpus.mjs";
import { jsBackend, runJsCase, runJsInterop } from "./backend-js.mjs";
import { goBackend, prepareGoBackend, runGoCase, runGoInterop } from "./backend-go.mjs";
import { auditVerdict, compareObservations, judge } from "./judge.mjs";
import { mapPool } from "./process.mjs";

/**
 * Every status a case can end in. The summary prints all of them, and
 * `verifyCounts` asserts they sum to the number of rows the table rendered, so
 * a status cannot be introduced later and quietly fall out of the scoreboard.
 */
const STATUS_ORDER = ["pass", "xpass", "xfail", "unsupported", "fail", "unmeasured"];

function parseArguments(argv) {
  const options = { backend: "both", interop: false, onlyInterop: false, json: false, quiet: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case "--backend":
        options.backend = argv[++index];
        break;
      case "--filter":
        options.filter = argv[++index];
        break;
      case "--interop":
        options.interop = true;
        break;
      case "--only-interop":
        options.interop = true;
        options.onlyInterop = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--jobs":
        options.jobs = Number(argv[++index]);
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--report-only":
        options.reportOnly = true;
        break;
      case "--fork-checkout":
        options.forkCheckout = argv[++index];
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown option ${argument}`);
    }
  }
  if (!["js", "go", "both"].includes(options.backend)) {
    throw new Error(`--backend must be js, go, or both (got ${options.backend})`);
  }
  return options;
}

function pad(text, width) {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

const NOTE_WIDTH = 200;

/** Keep a row one line, but never silently: a cut note says it was cut. */
function truncateNote(text) {
  return text.length <= NOTE_WIDTH ? text : `${text.slice(0, NOTE_WIDTH - 3)}... [truncated]`;
}

/** One line naming what a case declares, for the divergence sections. */
function describeExpectation(entry) {
  if (entry.expect === "output") return `stdout ${JSON.stringify(entry.declared?.stdout ?? [])}`;
  const declared = (entry.declared?.diagnostics ?? [])
    .map((item) => `${item.code}@${item.line}:${item.column}`)
    .join(", ");
  return `diagnostics [${declared}]`;
}

/**
 * Row marks. Each one is also spelled out in `CLASS`, and the summary uses the
 * same words, so filtering the output for the name of a class finds both the
 * rows and the tally. The previous table said `FAIL` while the summary said
 * "divergent", and a divergence could be looked for by name and not found.
 */
const MARK = {
  pass: "pass",
  fail: "FAIL",
  unsupported: "unsup",
  xfail: "xfail",
  xpass: "XPASS",
  unmeasured: "UNMEAS",
  skip: "skip",
};

const CLASS = {
  pass: "pass",
  fail: "divergent",
  unsupported: "unsupported",
  xfail: "xfail",
  xpass: "xpass",
  unmeasured: "unmeasured",
};

export async function runConformance(options = {}) {
  const backend = options.backend ?? "both";
  const wantJs = backend === "js" || backend === "both";
  const wantGo = backend === "go" || backend === "both";
  // `options.cases` exists for the harness's own self-test, which runs
  // deliberately broken expectations through the real backends and asserts the
  // runner notices. Nothing else supplies it; the corpus on disk is the corpus.
  const cases = options.cases ?? (options.onlyInterop ? [] : loadCorpus({ filter: options.filter }));
  const interopCases = options.interop || options.onlyInterop ? loadInterop({ filter: options.filter }) : [];

  const report = {
    audit: [],
    cases: cases.map((testCase) => ({
      id: testCase.id,
      area: testCase.area,
      title: testCase.expectation.title,
      expect: testCase.expectation.expect,
      xfail: testCase.expectation.xfail,
      // The declared expectation travels with the row so a report can be read
      // — and a divergence understood — without going back to the corpus.
      declared: {
        stdout: testCase.expectation.stdout,
        diagnostics: testCase.expectation.diagnostics,
      },
      results: {},
      agreement: undefined,
    })),
    interop: interopCases.map((interopCase) => ({ id: interopCase.id, results: {} })),
    backends: {},
  };
  const byId = new Map(report.cases.map((entry) => [entry.id, entry]));
  const interopById = new Map(report.interop.map((entry) => [entry.id, entry]));
  const observations = { js: new Map(), go: new Map() };

  if (wantJs) {
    const reason = await jsBackend.probe();
    if (reason) {
      report.backends.js = { available: false, reason };
    } else {
      report.backends.js = { available: true, label: jsBackend.label };
      await mapPool(cases, options.jobs ?? 6, async (testCase) => {
        const observation = await runJsCase(testCase);
        observations.js.set(testCase.id, observation);
        const verdict = judge(testCase, observation, "js");
        report.audit.push(...auditVerdict(testCase, observation, verdict, jsBackend));
        byId.get(testCase.id).results.js = { ...verdict, observation };
      });
      await mapPool(interopCases, options.jobs ?? 6, async (interopCase) => {
        const observation = await runJsInterop(interopCase);
        interopById.get(interopCase.id).results.js = { observation, ...judgeInterop(interopCase, observation) };
      });
    }
  }

  let goContext;
  if (wantGo) {
    goContext = await prepareGoBackend({ forkCheckout: options.forkCheckout });
    if (goContext.unavailable) {
      report.backends.go = { available: false, reason: goContext.unavailable };
    } else {
      report.backends.go = { available: true, label: goBackend.label };
      try {
        await mapPool(cases, options.jobs ?? 4, async (testCase) => {
          const observation = await runGoCase(goContext, testCase);
          observations.go.set(testCase.id, observation);
          const verdict = judge(testCase, observation, "go");
          report.audit.push(...auditVerdict(testCase, observation, verdict, goBackend));
          byId.get(testCase.id).results.go = { ...verdict, observation };
        });
        await mapPool(interopCases, options.jobs ?? 4, async (interopCase) => {
          const observation = await runGoInterop(goContext, interopCase);
          interopById.get(interopCase.id).results.go = { observation, ...judgeInterop(interopCase, observation) };
        });
      } finally {
        await goContext.dispose();
      }
    }
  }

  if (wantJs && wantGo && report.backends.js?.available && report.backends.go?.available) {
    for (const entry of report.cases) {
      const left = observations.js.get(entry.id);
      const right = observations.go.get(entry.id);
      if (!left || !right) continue;
      entry.agreement = compareObservations(left, right);
    }
  }

  report.summary = summarize(report, { wantJs, wantGo });
  report.audit.push(...verifyCounts(report));
  return report;
}

function judgeInterop(interopCase, observation) {
  const expected = interopCase.expectation.stdout;
  if (observation.kind === "error" || observation.kind === "rejected") {
    return { status: "unmeasured", detail: observation.reason ?? `the backend returned ${observation.kind}` };
  }
  if (observation.kind !== "output") {
    return {
      status: "fail",
      detail:
        observation.kind === "diagnostics"
          ? `rejected: ${observation.diagnostics.map((item) => item.code).join(", ")}`
          : (observation.reason ?? observation.kind),
    };
  }
  if (observation.exitCode !== 0) return { status: "fail", detail: `exit ${observation.exitCode}` };
  const same =
    expected.length === observation.stdout.length && expected.every((line, index) => line === observation.stdout[index]);
  return same
    ? { status: "pass", detail: "" }
    : { status: "fail", detail: `stdout ${JSON.stringify(observation.stdout)} != ${JSON.stringify(expected)}` };
}

function tally(entries, backend) {
  const counts = Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]));
  let total = 0;
  let unknown = 0;
  let missing = 0;
  for (const entry of entries) {
    const result = entry.results[backend];
    if (!result) {
      missing += 1;
      continue;
    }
    total += 1;
    // A status the scoreboard does not know about must not vanish into a
    // `NaN`; it is counted separately and reported as an integrity failure.
    if (counts[result.status] === undefined) unknown += 1;
    else counts[result.status] += 1;
  }
  return { total, ...counts, unknown, missing, entries: entries.length };
}

/**
 * The summary must be arithmetic on the same rows the table prints.
 *
 * Before this, the JS summary line printed `pass + xpass`, `fail`, `xfail` and
 * `xpass` and simply never mentioned the other buckets, so a case in one of
 * them was absent from the numerator, absent from the classes, and invisible.
 * Here every bucket has to add up to the number of judged rows, and every
 * judged row has to exist, or the run is reported as untrustworthy.
 */
function verifyCounts(report) {
  const violations = [];
  for (const [name, entries] of [
    ["js", report.cases],
    ["go", report.cases],
    ["jsInterop", report.interop],
    ["goInterop", report.interop],
  ]) {
    const counts = report.summary[name];
    if (!counts) continue;
    const summed = STATUS_ORDER.reduce((total, status) => total + counts[status], 0);
    if (summed !== counts.total) {
      violations.push(`summary/${name}: statuses sum to ${summed} but ${counts.total} cases were judged`);
    }
    if (counts.unknown > 0) {
      violations.push(`summary/${name}: ${counts.unknown} case(s) ended in a status the scoreboard does not print`);
    }
    if (counts.missing > 0) {
      violations.push(
        `summary/${name}: ${counts.missing} of ${counts.entries} case(s) never received a verdict from a backend that ran`,
      );
    }
  }
  return violations;
}

function summarize(report, { wantJs, wantGo }) {
  const summary = {};
  if (wantJs && report.backends.js?.available) {
    summary.js = tally(report.cases, "js");
    summary.jsInterop = tally(report.interop, "js");
  }
  if (wantGo && report.backends.go?.available) {
    summary.go = tally(report.cases, "go");
    summary.goInterop = tally(report.interop, "go");
  }
  if (summary.js && summary.go) {
    summary.agreement = {
      compared: report.cases.filter((entry) => entry.agreement).length,
      agreed: report.cases.filter((entry) => entry.agreement?.agree).length,
    };
  }
  return summary;
}

function renderTable(report, { wantJs, wantGo, quiet }) {
  const lines = [];
  const idWidth = Math.max(4, ...report.cases.map((entry) => entry.id.length));
  // Counted from the rows this function actually emits, then checked against
  // the summary below. A scoreboard whose totals are computed independently of
  // its rows can disagree with them, and this one did.
  const rendered = {
    js: Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])),
    go: Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])),
  };
  if (report.cases.length > 0) {
    const header = `${pad("case", idWidth)}  ${wantJs ? pad("js", 6) : ""}${wantGo ? pad("go", 6) : ""} note`;
    if (!quiet) {
      lines.push(header);
      lines.push("-".repeat(header.length));
    }
    let area;
    for (const entry of report.cases) {
      const js = entry.results.js;
      const go = entry.results.go;
      if (js && rendered.js[js.status] !== undefined) rendered.js[js.status] += 1;
      if (go && rendered.go[go.status] !== undefined) rendered.go[go.status] += 1;
      if (quiet) continue;
      if (entry.area !== area) {
        area = entry.area;
        lines.push(`# ${area}`);
      }
      const notes = [];
      if (js && js.status !== "pass" && js.detail) notes.push(`js ${CLASS[js.status]}: ${js.detail}`);
      if (go && go.status !== "pass" && go.detail) notes.push(`go ${CLASS[go.status]}: ${go.detail}`);
      if (entry.agreement && !entry.agreement.agree && !(go && go.status === "unsupported")) {
        notes.push(`diff: ${entry.agreement.detail}`);
      }
      lines.push(
        `${pad(entry.id, idWidth)}  ` +
          `${wantJs ? pad(js ? MARK[js.status] : MARK.skip, 6) : ""}` +
          `${wantGo ? pad(go ? MARK[go.status] : MARK.skip, 6) : ""} ` +
          truncateNote(notes.join(" | ")),
      );
    }
    if (!quiet) lines.push("");
  }

  // The classes a reader most needs to see, spelled out with the same words the
  // summary uses and with their detail intact. A row's note is width-limited;
  // these are not, because a divergence that is cut off mid-diff is a
  // divergence nobody can act on.
  for (const status of ["fail", "unmeasured"]) {
    for (const [name, want] of [["js", wantJs], ["go", wantGo]]) {
      if (!want) continue;
      const hits = report.cases.filter((entry) => entry.results[name]?.status === status);
      if (hits.length === 0) continue;
      lines.push(`# ${name} ${CLASS[status]} (${MARK[status]}) — ${hits.length}`);
      for (const entry of hits) {
        lines.push(`  ${entry.id}`);
        lines.push(`    expected: ${describeExpectation(entry)}`);
        lines.push(`    observed: ${entry.results[name].detail}`);
      }
      lines.push("");
    }
  }

  if (!quiet && report.interop.length > 0) {
    lines.push("# interop (plain TypeScript through the fork)");
    for (const entry of report.interop) {
      const js = entry.results.js;
      const go = entry.results.go;
      const notes = [js && js.status !== "pass" ? `js: ${js.detail}` : "", go && go.status !== "pass" ? `go: ${go.detail}` : ""]
        .filter(Boolean)
        .join(" | ");
      lines.push(
        `${pad(entry.id, idWidth)}  ` +
          `${wantJs ? pad(js ? MARK[js.status] : MARK.skip, 6) : ""}` +
          `${wantGo ? pad(go ? MARK[go.status] : MARK.skip, 6) : ""} ${notes}`,
      );
    }
    lines.push("");
  }

  for (const [name, available] of [
    ["js", report.backends.js],
    ["go", report.backends.go],
  ]) {
    if (available && !available.available) lines.push(`${name}: unavailable — ${available.reason}`);
  }

  const summary = report.summary;
  if (summary.js) {
    lines.push(
      `JS reference:  ${summary.js.pass}/${summary.js.total} pass` +
        `, ${classBreakdown(summary.js)}`,
    );
  }
  if (summary.go) {
    lines.push(
      `Go fork match: ${summary.go.pass}/${summary.go.total} match the reference` +
        `, ${classBreakdown(summary.go)}`,
    );
  }
  if (summary.agreement) {
    lines.push(`Backend agreement: ${summary.agreement.agreed}/${summary.agreement.compared} identical observations`);
  }
  if (summary.jsInterop?.total) {
    lines.push(`Interop (js):  ${summary.jsInterop.pass}/${summary.jsInterop.total} pass, ${classBreakdown(summary.jsInterop)}`);
  }
  if (summary.goInterop?.total) {
    lines.push(`Interop (go):  ${summary.goInterop.pass}/${summary.goInterop.total} pass, ${classBreakdown(summary.goInterop)}`);
  }

  // The last word belongs to the cross-check: the classes printed above are
  // recounted from the rows printed at the top, and any disagreement is stated
  // in the same output rather than left for a reader to discover.
  for (const [name, want] of [["js", wantJs], ["go", wantGo]]) {
    if (!want || !summary[name]) continue;
    for (const status of STATUS_ORDER) {
      if (rendered[name][status] === summary[name][status]) continue;
      lines.push(
        `HARNESS INTEGRITY: the ${name} table shows ${rendered[name][status]} ${CLASS[status]} row(s) ` +
          `but the summary counts ${summary[name][status]}`,
      );
    }
  }
  for (const violation of report.audit ?? []) {
    lines.push(`HARNESS INTEGRITY: ${violation}`);
  }
  return lines.join("\n");
}

/** Every class, always, including the ones that are zero. */
function classBreakdown(counts) {
  return STATUS_ORDER.filter((status) => status !== "pass")
    .map((status) => `${counts[status]} ${CLASS[status]}`)
    .join(", ");
}

const HELP = `usage: node conformance/runner/run.mjs [options]

  --backend <js|go|both>  backends to run (default both)
  --filter <substring>    only cases whose id contains the substring
  --interop               also run the plain-TypeScript interop spot-check
  --only-interop          run only the interop spot-check
  --json                  machine-readable report
  --jobs <n>              parallel cases per backend
  --quiet                 summary only
  --report-only           exit 0 for a verdict failure (never for exit 2 or 3)
  --fork-checkout <dir>   pinned smithersai/TypeScript checkout

exit codes
  0  the backends asked to gate were green
  1  a verdict failure (suppressed by --report-only)
  2  a case could not be measured, or a requested backend could not be prepared
  3  a harness-integrity failure: a verdict not backed by the checks it claims,
     or a summary whose counts disagree with the rows
`;

async function main(argv) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`);
    return 64;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const report = await runConformance(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${renderTable(report, {
        wantJs: options.backend !== "go",
        wantGo: options.backend !== "js",
        quiet: options.quiet,
      })}\n`,
    );
  }

  // Integrity first, and never suppressed: if a verdict was not backed by the
  // checks it claims, or the scoreboard disagrees with its own rows, then no
  // number in this report means anything and saying so is the only useful
  // outcome.
  if ((report.audit ?? []).length > 0) {
    for (const violation of report.audit) process.stderr.write(`conformance: harness integrity: ${violation}\n`);
    return 3;
  }
  // A case nobody could measure is not a result. It never becomes "unsupported"
  // (which would read as migration progress) and it is not suppressible, on
  // either backend, in any mode.
  const unmeasured = (report.summary.js?.unmeasured ?? 0) + (report.summary.go?.unmeasured ?? 0) +
    (report.summary.jsInterop?.unmeasured ?? 0) + (report.summary.goInterop?.unmeasured ?? 0);
  if (unmeasured > 0) {
    process.stderr.write(`conformance: ${unmeasured} case(s) could not be measured; the run is not a measurement\n`);
    return 2;
  }

  // The JS reference is a gate. The Go backend is a measurement while the
  // migration is in progress, and only gates when it is asked for alone.
  if (options.backend === "js" || options.backend === "both") {
    if (report.backends.js && !report.backends.js.available) return 2;
  }
  if (options.backend === "go" && report.backends.go && !report.backends.go.available) return 2;

  // A run that measured nothing is not a green run, it is an absent one. With
  // `--filter` matching no case (or a corpus that failed to load) every bucket
  // is legitimately zero, every integrity check is satisfied by arithmetic on
  // no rows, and the runner printed `0/0 pass` and exited 0 — the same "green
  // without doing the work" shape the Node and Go gates each had to grow a
  // census to refuse. It is checked after the availability tests above so an
  // unprepared backend still reports itself rather than being described as an
  // empty corpus.
  const measured = (report.summary.js?.total ?? 0) + (report.summary.go?.total ?? 0) +
    (report.summary.jsInterop?.total ?? 0) + (report.summary.goInterop?.total ?? 0);
  if (measured === 0) {
    process.stderr.write(
      "conformance: no case was measured, so this run is not a measurement" +
        `${options.filter ? ` (--filter ${JSON.stringify(options.filter)} matched nothing)` : ""}\n`,
    );
    return 2;
  }
  if (options.reportOnly) return 0;
  const jsFailures = (report.summary.js?.fail ?? 0) + (report.summary.jsInterop?.fail ?? 0);
  const goFailures = (report.summary.go?.fail ?? 0) + (report.summary.goInterop?.fail ?? 0);
  if (options.backend === "js" || options.backend === "both") {
    if (jsFailures > 0) return 1;
  }
  // `--backend both` used to gate on the reference alone: the `go` arm below was
  // reached only by `--backend go`, so a run that measured both backends fell
  // through to `return 0` no matter how many Go cases failed or how far the two
  // backends had drifted apart. That is the "green without doing the work" shape
  // this repository has now found four times — a Go step that skipped 143 records
  // and printed `ok`, a `node --test` glob that exited 0 having run nothing, a
  // `doctor` that returned a hardcoded `ok: true`, and this. It mattered: the
  // exit code was quoted as evidence of zero divergences while `fail` on the Go
  // side is exactly how a divergence is recorded (see DIVERGENCE_STATUS above).
  if (options.backend === "go" || options.backend === "both") {
    if (goFailures > 0) return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`conformance: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

export { renderTable };
