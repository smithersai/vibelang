#!/usr/bin/env node
/**
 * Smithers differential conformance runner.
 *
 * Four modes, all over the same corpus:
 *
 *   --backend js        run the JS instrument only (the reference; a real gate)
 *   --backend go        run the pinned Go fork only (the migration target)
 *   --backend both      run both and diff them (default)
 *   --backend js-yield  run the reference and the `effectLowering: "yield"`
 *                       lowering of the same instrument, and diff them
 *
 * Usage:
 *   node conformance/runner/run.mjs [options]
 *
 *   --backend <js|go|both|js-yield>  which backends to run (default both)
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
 * **`--backend both` gates on BOTH backends**, including the fork, in both of
 * the ways a backend can fail to be green:
 *
 *   - a Go *verdict* failure exits 1 even when the reference is entirely green.
 *     Measured, not asserted — a case scored `js pass / go FAIL` under
 *     `--backend both` exits 1, and the same run under `--report-only` exits 0.
 *   - a Go backend that could not be *prepared* exits 2. `both` asked for the
 *     fork, so a run in which the fork never compiled a case is not a
 *     measurement of the fork, and saying so is the only honest outcome.
 *
 * The second half was added on 2026-08-28 and is the more embarrassing of the
 * two, because the first had already been fixed: a Go FAIL gated under `both`
 * while a Go that never ran did not, so "we looked and found a divergence"
 * exited 1 and "we never looked" exited 0. `both` is the DEFAULT mode, which
 * made the bare `node conformance/runner/run.mjs` degrade silently into
 * `--backend js` on any machine without a fork checkout while still printing
 * `0 divergent` and `Markers holding a fail-open: 0`. A caller who wants the
 * reference gate without a fork asks for `--backend js`, which is documented as
 * exactly that and is unaffected.
 *
 * This paragraph said the opposite until 2026-08-26, and it is worth knowing why
 * rather than just that it was fixed. `--backend both` really did fall through
 * to `return 0` no matter how many Go cases diverged; the `go` arm below was
 * reached only by `--backend go`. When that was corrected, the exit-code
 * computation was edited and **this header was not**, so the file documented
 * behaviour it no longer had — and it documented it *flatteringly*, which is the
 * dangerous direction. A reader who trusted it would conclude the exit code
 * carries no information about the fork, which is precisely the misreading that
 * let two backends produce different requirement rows for the same program for a
 * full day while the scoreboard read zero divergences. If you change an exit
 * path, change this block in the same edit.
 *
 * FOUR things are NOT verdicts and are never suppressed by `--report-only`,
 * because each of them means the numbers printed cannot be trusted. All four are
 * checked *before* the `--report-only` short-circuit, which is what makes that
 * sentence true rather than intended:
 *
 *   exit 3  a harness-integrity failure — a verdict that was not backed by the
 *           checks it claims (see `auditVerdict`), or a summary whose counts do
 *           not add up to the rows that were rendered
 *   exit 2  a case the harness could not measure at all; or a backend that was
 *           asked for and could not be prepared — "asked for" means named by
 *           `--backend`, so `both` asks for both; or a run in which NO case was
 *           measured at all — `--filter` matching nothing used to print
 *           `0/0 pass` and exit 0, which is green without doing the work.
 *           `runner/selftest.mjs` holds the last two.
 *
 * (The list said "three" and named the first two of the exit-2 conditions; the
 * empty-run check was added later and never joined it. Counted again here from
 * the code below rather than from the previous sentence.)
 *
 * A fifth code is not a verdict either and is not about the corpus at all:
 *
 *   exit 64 a usage error — an unknown option, or a `--backend` value that is
 *           not js/go/both. Printed with the help text, before any case runs.
 *
 * That separation is deliberate. A missing check and a crashed backend both
 * *raise* a score if they are quietly absorbed into an existing bucket, so they
 * get their own bucket and their own exit code.
 */

import { loadCorpus, loadInterop } from "./corpus.mjs";
import { jsBackend, runJsCase, runJsInterop } from "./backend-js.mjs";
import { goBackend, prepareGoBackend, runGoCase, runGoInterop } from "./backend-go.mjs";
import { jsYieldBackend, runJsYieldCase, runJsYieldInterop } from "./backend-js-yield.mjs";
import { auditVerdict, canonicalExpectation, compareObservations, judge } from "./judge.mjs";
import { mapPool } from "./process.mjs";

/**
 * Every status a case can end in. The summary prints all of them, and
 * `verifyCounts` asserts they sum to the number of rows the table rendered, so
 * a status cannot be introduced later and quietly fall out of the scoreboard.
 */
const STATUS_ORDER = ["pass", "xpass", "xfail", "unsupported", "fail", "unmeasured"];

/** Every backend this runner knows how to ask. Order is report order. */
const BACKENDS = ["js", "go", "js-yield"];

/**
 * What each `--backend` value asks for, as one table.
 *
 * `js-yield` asks for the reference alongside it, exactly as `both` asks for
 * the reference alongside the fork, and for the same reason: the claim that
 * backend exists to check is a DIFFERENCE — one program, two calling
 * conventions, one observation — and a column with nothing beside it cannot
 * state a difference. See `backend-js-yield.mjs`.
 */
const BACKEND_SELECTIONS = {
  js: ["js"],
  go: ["go"],
  both: ["js", "go"],
  "js-yield": ["js", "js-yield"],
};

/**
 * The backends one `--backend` value asks for.
 *
 * One definition, because the question is asked four times — what to prepare,
 * what to enforce availability on, what to summarize and render, and what to
 * gate the exit code on — and it used to be hand-written at every one of those
 * sites, in three different spellings (`b === "js" || b === "both"`, `b !== "go"`,
 * and a bare `b === "go"`). Eight transcriptions of one three-valued question is
 * eight chances to write a different answer, and one of them did: the
 * availability arm enforced `js`/`both` for the reference and only `go` for the
 * fork, so `--backend both` on a machine that could not prepare the fork printed
 * `go: unavailable — <reason>` and exited 0.
 *
 * The two gating sites below iterate this list rather than naming a backend
 * each, so a backend cannot be enforced in one place and forgotten in the other.
 */
export function requestedBackends(backend) {
  const selection = BACKEND_SELECTIONS[backend];
  return selection ? BACKENDS.filter((name) => selection.includes(name)) : [];
}

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
  if (!Object.hasOwn(BACKEND_SELECTIONS, options.backend)) {
    throw new Error(
      `--backend must be one of ${Object.keys(BACKEND_SELECTIONS).join(", ")} (got ${options.backend})`,
    );
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

/**
 * One line naming what a case declares, for the divergence sections.
 *
 * The file is printed alongside the position, in the same spelling
 * `judge.mjs`'s `formatDiagnostics` uses for the observed side, so the
 * `expected:`/`observed:` pair under a divergence can be read as a diff. It
 * printed `code@line:column` while the file was not compared, which made a
 * wrong-file divergence render as two identical lines.
 */
function describeExpectation(entry) {
  if (entry.expect === "output") return `stdout ${JSON.stringify(entry.declared?.stdout ?? [])}`;
  const declared = (entry.declared?.diagnostics ?? [])
    .map((item) => (item.file === undefined ? `${item.code}@${item.line}:${item.column}` : `${item.code}@${item.file}:${item.line}:${item.column}`))
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
  const requested = requestedBackends(backend);
  const wantJs = requested.includes("js");
  const wantGo = requested.includes("go");
  const wantJsYield = requested.includes("js-yield");
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
      // — and a divergence understood — without going back to the corpus. In
      // the canonical form the judge actually compared, so a diagnostic that
      // named no file shows the entry it was resolved to rather than leaving a
      // reader to work out which file the row is about.
      declared: {
        stdout: testCase.expectation.stdout,
        diagnostics: testCase.expectation.expect === "diagnostics" ? canonicalExpectation(testCase) : undefined,
      },
      results: {},
      agreement: undefined,
    })),
    interop: interopCases.map((interopCase) => ({ id: interopCase.id, results: {} })),
    backends: {},
  };
  const byId = new Map(report.cases.map((entry) => [entry.id, entry]));
  const interopById = new Map(report.interop.map((entry) => [entry.id, entry]));
  const observations = Object.fromEntries(BACKENDS.map((name) => [name, new Map()]));

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

  if (wantJsYield) {
    // Runs the same instrument as the reference, so its availability is the
    // reference's: bun. Probed through its own descriptor anyway, because a
    // backend that inherited another's availability could not report itself as
    // unavailable and would be scored on cases it never ran.
    const reason = await jsYieldBackend.probe();
    if (reason) {
      report.backends["js-yield"] = { available: false, reason };
    } else {
      report.backends["js-yield"] = { available: true, label: jsYieldBackend.label };
      await mapPool(cases, options.jobs ?? 6, async (testCase) => {
        const observation = await runJsYieldCase(testCase);
        observations["js-yield"].set(testCase.id, observation);
        const verdict = judge(testCase, observation, "js-yield");
        report.audit.push(...auditVerdict(testCase, observation, verdict, jsYieldBackend));
        byId.get(testCase.id).results["js-yield"] = { ...verdict, observation };
      });
      await mapPool(interopCases, options.jobs ?? 6, async (interopCase) => {
        const observation = await runJsYieldInterop(interopCase);
        interopById.get(interopCase.id).results["js-yield"] = {
          observation,
          ...judgeInterop(interopCase, observation),
        };
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

  // The pair is derived from what was requested rather than named, so
  // `--backend both` still diffs js against go and `--backend js-yield` diffs
  // js against js-yield with the same code, the same detail strings, and the
  // same `Backend agreement:` line. A selection of one backend has no pair and
  // leaves `agreement` undefined, exactly as before.
  const pair = requested.length === 2 && requested.every((name) => report.backends[name]?.available)
    ? requested
    : undefined;
  if (pair) {
    for (const entry of report.cases) {
      const left = observations[pair[0]].get(entry.id);
      const right = observations[pair[1]].get(entry.id);
      if (!left || !right) continue;
      entry.agreement = compareObservations(left, right, pair[0], pair[1]);
    }
  }

  report.summary = summarize(report, requested, pair);
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

/** One backend's interop bucket in the summary. */
function interopKey(backend) {
  return `${backend}Interop`;
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
  const rows = BACKENDS.flatMap((name) => [[name, report.cases], [interopKey(name), report.interop]]);
  for (const [name, entries] of rows) {
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

/**
 * Which `xfail` markers hold a **fail-open** — a backend that accepts, compiles
 * and RUNS a program the corpus requires it to reject.
 *
 * This is derived, and it is derived because the hand-maintained copies of it
 * were wrong twice inside one day: `conformance/README.md` asserted that no
 * marker held a fail-open while one did, was corrected, and the correction was
 * stale by the next morning when that fail-open closed. The fact was written
 * down in two Markdown paragraphs and maintained in neither reliably.
 *
 * Nothing here is a new measurement. Every input is already in hand by the time
 * a verdict is scored: the case's own `expect`, and the observation the backend
 * produced. The predicate is exactly the README's definition of the class —
 * `expect: "diagnostics"` (the language requires this program to be rejected)
 * met with `kind: "output"` (the backend ran it instead) on a backend the case
 * marks `xfail`, so the run scored it `xfail` rather than `divergent` and the
 * headline `0 divergent` says nothing about it.
 *
 * A marked `expect: "output"` case is deliberately NOT counted. Those are the
 * accepted-and-wrong class — a program the language does not require anyone to
 * reject, which is a different and harder-to-find thing, and calling it a
 * fail-open would inflate this number with rows that can never leave it.
 *
 * The exit code is not part of the predicate: a program that is accepted and
 * then crashes is still a rule that failed open. It is reported beside the row
 * so the two are distinguishable by eye.
 */
function failOpenMarkers(report, backend) {
  const holding = [];
  for (const entry of report.cases) {
    const result = entry.results[backend];
    if (result?.status !== "xfail") continue;
    if (entry.expect !== "diagnostics") continue;
    if (result.observation?.kind !== "output") continue;
    holding.push({ id: entry.id, exitCode: result.observation.exitCode });
  }
  return holding;
}

function summarize(report, requested, pair) {
  const summary = {};
  const ran = requested.filter((name) => report.backends[name]?.available);
  for (const name of ran) {
    summary[name] = tally(report.cases, name);
    summary[interopKey(name)] = tally(report.interop, name);
  }
  if (pair) {
    summary.agreement = {
      compared: report.cases.filter((entry) => entry.agreement).length,
      agreed: report.cases.filter((entry) => entry.agreement?.agree).length,
    };
  }
  // Derived for whichever backends ran, and always present when one did, so
  // "no marker holds a fail-open" is a printed measurement rather than a
  // sentence somebody has to remember to update.
  const failOpen = {};
  for (const name of ran) failOpen[name] = failOpenMarkers(report, name);
  if (ran.length > 0) summary.failOpenMarkers = failOpen;
  return summary;
}

function renderTable(report, { requested, quiet }) {
  const lines = [];
  const idWidth = Math.max(4, ...report.cases.map((entry) => entry.id.length));
  // One column per requested backend, in report order, each as wide as its own
  // name needs. A two-backend run renders exactly the two six-wide columns it
  // always did; a name longer than five characters widens only its own column.
  const columns = requested.map((name) => ({ name, width: Math.max(6, name.length + 1) }));
  // Counted from the rows this function actually emits, then checked against
  // the summary below. A scoreboard whose totals are computed independently of
  // its rows can disagree with them, and this one did.
  const rendered = Object.fromEntries(
    requested.map((name) => [name, Object.fromEntries(STATUS_ORDER.map((status) => [status, 0]))]),
  );
  const cells = (entry) =>
    columns.map(({ name, width }) => {
      const result = entry.results[name];
      return pad(result ? MARK[result.status] : MARK.skip, width);
    }).join("");
  if (report.cases.length > 0) {
    const header = `${pad("case", idWidth)}  ${columns.map(({ name, width }) => pad(name, width)).join("")} note`;
    if (!quiet) {
      lines.push(header);
      lines.push("-".repeat(header.length));
    }
    let area;
    for (const entry of report.cases) {
      for (const { name } of columns) {
        const result = entry.results[name];
        if (result && rendered[name][result.status] !== undefined) rendered[name][result.status] += 1;
      }
      if (quiet) continue;
      if (entry.area !== area) {
        area = entry.area;
        lines.push(`# ${area}`);
      }
      const notes = [];
      for (const { name } of columns) {
        const result = entry.results[name];
        if (result && result.status !== "pass" && result.detail) {
          notes.push(`${name} ${CLASS[result.status]}: ${result.detail}`);
        }
      }
      // An `unsupported` verdict on the compared backend is already the note;
      // repeating it as a diff would report the same fact twice.
      const compared = entry.results[columns[columns.length - 1]?.name];
      if (entry.agreement && !entry.agreement.agree && !(compared && compared.status === "unsupported")) {
        notes.push(`diff: ${entry.agreement.detail}`);
      }
      lines.push(`${pad(entry.id, idWidth)}  ${cells(entry)} ${truncateNote(notes.join(" | "))}`);
    }
    if (!quiet) lines.push("");
  }

  // The classes a reader most needs to see, spelled out with the same words the
  // summary uses and with their detail intact. A row's note is width-limited;
  // these are not, because a divergence that is cut off mid-diff is a
  // divergence nobody can act on.
  for (const status of ["fail", "unmeasured"]) {
    for (const name of requested) {
      const hits = report.cases.filter((entry) => entry.results[name]?.status === status);
      if (hits.length === 0) continue;
      lines.push(`# ${name} ${CLASS[status]} (${MARK[status]}) \u2014 ${hits.length}`);
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
      const notes = columns
        .map(({ name }) => {
          const result = entry.results[name];
          return result && result.status !== "pass" ? `${name}: ${result.detail}` : "";
        })
        .filter(Boolean)
        .join(" | ");
      lines.push(`${pad(entry.id, idWidth)}  ${cells(entry)} ${notes}`);
    }
    lines.push("");
  }

  for (const name of requested) {
    const available = report.backends[name];
    if (available && !available.available) lines.push(`${name}: unavailable \u2014 ${available.reason}`);
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
  if (summary["js-yield"]) {
    lines.push(
      `JS yield:      ${summary["js-yield"].pass}/${summary["js-yield"].total} pass` +
        `, ${classBreakdown(summary["js-yield"])}`,
    );
  }
  if (summary.agreement) {
    lines.push(`Backend agreement: ${summary.agreement.agreed}/${summary.agreement.compared} identical observations`);
  }
  if (summary.failOpenMarkers) {
    // Printed on every run, including when it is zero. `0 divergent` is silent
    // about a fail-open that carries a marker \u2014 that is what a marker means \u2014
    // so this line is the one that is not, and it is derived from the same
    // observations the table above prints rather than from any document.
    const holding = Object.entries(summary.failOpenMarkers).flatMap(([backend, rows]) =>
      rows.map((row) => ({ backend, ...row })),
    );
    lines.push(
      `Markers holding a fail-open: ${holding.length}` +
        (holding.length === 0
          ? " (no marked backend accepts and runs a program the corpus requires it to reject)"
          : ""),
    );
    for (const row of holding) {
      lines.push(`  ${row.backend}: ${row.id} \u2014 accepted and ran (exit ${row.exitCode})`);
    }
  }
  for (const name of requested) {
    const interop = summary[interopKey(name)];
    if (interop?.total) {
      lines.push(`Interop (${name}):  ${interop.pass}/${interop.total} pass, ${classBreakdown(interop)}`);
    }
  }

  // The last word belongs to the cross-check: the classes printed above are
  // recounted from the rows printed at the top, and any disagreement is stated
  // in the same output rather than left for a reader to discover.
  for (const name of requested) {
    if (!summary[name]) continue;
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

  --backend <js|go|both|js-yield>
                          backends to run (default both). js-yield runs the
                          reference AND the effectLowering "yield" lowering of
                          the same instrument, and diffs them
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
  1  a verdict failure on a backend asked to gate (suppressed by --report-only).
     --backend both gates on BOTH: a Go failure exits 1 with the reference green
  2  a case could not be measured, a requested backend could not be prepared
     (--backend both requests both, so an unpreparable fork exits 2), or
     no case was measured at all
  3  a harness-integrity failure: a verdict not backed by the checks it claims,
     or a summary whose counts disagree with the rows
  64 a usage error (unknown option, or an unknown --backend value)
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

  // The one derivation of "which backends did the caller ask for", shared with
  // `runConformance` and with both gating loops below. It was spelled three
  // different ways across those four sites, and the table's spelling
  // (`!== "go"` / `!== "js"`) was the only one that could not be compared to the
  // others by eye.
  const requested = requestedBackends(options.backend);
  const report = await runConformance(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `${renderTable(report, { requested, quiet: options.quiet })}\n`,
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
  const unmeasured = requested.reduce(
    (total, name) =>
      total + (report.summary[name]?.unmeasured ?? 0) + (report.summary[interopKey(name)]?.unmeasured ?? 0),
    0,
  );
  if (unmeasured > 0) {
    process.stderr.write(`conformance: ${unmeasured} case(s) could not be measured; the run is not a measurement\n`);
    return 2;
  }

  // A backend the caller ASKED FOR and the harness could not prepare is a
  // failure to measure, on every backend, in every mode — `both` included.
  //
  // This arm used to enforce the reference under `js`/`both` and the fork only
  // under `go`, so `--backend both` with an absent fork checkout printed
  // `go: unavailable — <reason>`, `0 divergent`, `Markers holding a fail-open: 0`
  // and exited 0. `both` is the DEFAULT mode, so that was the bare
  // `node conformance/runner/run.mjs` every gate quotes, silently degrading into
  // `--backend js` while still reading like a two-backend run.
  //
  // The asymmetry was backwards on its own terms as well. A Go *verdict* failure
  // has gated under `both` since 2026-08-26, so "we looked at the fork and found
  // a divergence" exited 1 while "we never looked at the fork at all" exited 0.
  // A caller who genuinely wants the reference gate without a fork checkout asks
  // for it by name: `--backend js` is documented as exactly that, and the loop
  // below never enforces a backend nobody requested.
  //
  // The reason goes to stderr rather than only into `renderTable`, because
  // `--json` prints no table and a machine-readable run got no reason at all.
  for (const name of requested) {
    const prepared = report.backends[name];
    if (prepared && !prepared.available) {
      process.stderr.write(
        `conformance: the ${name} backend was requested and could not be prepared: ${prepared.reason}\n` +
          `conformance: this run is not a measurement of ${name}\n`,
      );
      return 2;
    }
  }

  // A run that measured nothing is not a green run, it is an absent one. With
  // `--filter` matching no case (or a corpus that failed to load) every bucket
  // is legitimately zero, every integrity check is satisfied by arithmetic on
  // no rows, and the runner printed `0/0 pass` and exited 0 — the same "green
  // without doing the work" shape the Node and Go gates each had to grow a
  // census to refuse. It is checked after the availability tests above so an
  // unprepared backend still reports itself rather than being described as an
  // empty corpus.
  const measured = requested.reduce(
    (total, name) => total + (report.summary[name]?.total ?? 0) + (report.summary[interopKey(name)]?.total ?? 0),
    0,
  );
  if (measured === 0) {
    process.stderr.write(
      "conformance: no case was measured, so this run is not a measurement" +
        `${options.filter ? ` (--filter ${JSON.stringify(options.filter)} matched nothing)` : ""}\n`,
    );
    return 2;
  }
  if (options.reportOnly) return 0;
  // `--backend both` used to gate on the reference alone: the `go` arm was
  // reached only by `--backend go`, so a run that measured both backends fell
  // through to `return 0` no matter how many Go cases failed or how far the two
  // backends had drifted apart. That is the "green without doing the work" shape
  // this repository has now found four times — a Go step that skipped 143 records
  // and printed `ok`, a `node --test` glob that exited 0 having run nothing, a
  // `doctor` that returned a hardcoded `ok: true`, and this. It mattered: the
  // exit code was quoted as evidence of zero divergences while `fail` on the Go
  // side is exactly how a divergence is recorded.
  //
  // Fixed on 2026-08-26 by adding `|| "both"` to the `go` arm — which left the
  // availability arm above still hand-written per backend, and therefore still
  // wrong for `both`. Both arms now iterate one list, so the next backend added
  // is enforced in both places or in neither.
  for (const name of requested) {
    const failures = (report.summary[name]?.fail ?? 0) + (report.summary[interopKey(name)]?.fail ?? 0);
    if (failures > 0) return 1;
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
