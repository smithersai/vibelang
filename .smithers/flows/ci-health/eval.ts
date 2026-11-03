// The ci-health flow's eval: it runs the flow, unmocked, over fixture/, cut
// from real graph results and logs of 2026-10-30 and 2026-10-31 (paths
// scrubbed, runs renamed), and scores what it reports against facts read from
// those logs by hand:
//
// - //:docs-tools, //packages:compiler-test and //packages:unplugin-test each
//   passed and failed under one key: three flakes.
// - //:spec-tests failed twice under one key and never passed: main was broken
//   (TestCommandLineFlagsCoverSpec), so it must not count as a flake.
// - //:cached only replayed, and run-99 was cut off mid-write.
//
// A second case runs it over fixture-regression/: //packages:compiler-test and
// //:docs-tools from 22 cf pre-gates (10 on 2026-11-01 18-21Z, 12 on 2026-11-02
// 01-04Z, two of which timed out). The migrate suites joined compiler-test at
// 00:58Z: its median went from 138 s to 478 s. docs-tools went from 164 s to
// 228 s (1.4x) with no change of its own: load, not a regression. times.json
// gives each run's time, which collect reads from the file's mtime.
//
// Scorers: flaky, exactly the flaky targets; tests, the known flaky tests are
// named; causes, each target's top cause; slow, a replay never ranks as slow;
// regressed, exactly the targets that got slower, with the timeouts counted.
// A scorer whose field a case does not state scores 1 there.
//
//   bun .smithers/flows/ci-health/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/ci-health/eval.ts --update   run and record baseline.json
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { cpSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "./run.ts";
import { stepKey } from "../step-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baselineFile = join(here, "baseline.json");
const target = { name: "ci-health" };

type Input = {
  readonly fixture: string;
  readonly split: string;
  readonly flaky?: ReadonlyArray<string>;
  readonly tests?: ReadonlyArray<string>;
  readonly causes?: Readonly<Record<string, string>>;
  readonly regressed?: Readonly<Record<string, number>>;
};
type Output = {
  readonly flaky: ReadonlyArray<string>;
  readonly tests: ReadonlyArray<string>;
  readonly causes: Readonly<Record<string, string>>;
  readonly slow: ReadonlyArray<string>;
  readonly regressed: Readonly<Record<string, number>>;
};

const cases = [{
  name: "real-runs",
  input: {
    fixture: "fixture",
    split: "",
    flaky: ["//:docs-tools", "//packages:compiler-test", "//packages:unplugin-test"],
    tests: [
      "isolates run-mode output across projects when the second has a warning",
      "paths-imports: a paths alias resolves to the file the compiler resolves it to",
      "rollup: watch mode recompiles on .vibe, .ts and tsconfig changes"
    ],
    causes: { "//:docs-tools": "timeout", "//packages:unplugin-test": "timeout", "//packages:compiler-test": "property counterexample" }
  } satisfies Input
}, {
  name: "regression",
  // The slower targets, each with its timeouts after the split.
  input: { fixture: "fixture-regression", split: "2026-11-02T00:00:00Z", regressed: { "//packages:compiler-test": 2 } } satisfies Input
}];

// A real Go compilation failure, followed by a successful same-key retry.
cases.push({
  name: "go-cache-archive",
  input: {
    fixture: "fixture-go-cache",
    split: "",
    flaky: ["//:spec-tests"],
    tests: [],
    causes: { "//:spec-tests": "Go cache archive" }
  } satisfies Input
});

const score = (id: string, f: (input: Input, output: Output) => number) =>
  Scorer.make({ id: `ci-health/${id}`, version: "1", name: id, score: ({ input, output }) => Effect.succeed({ score: f(input as Input, output as Output) }) });

// Precision times recall of a set of labels.
const exactly = (want: ReadonlyArray<string>, got: ReadonlyArray<string>) => {
  const right = want.filter((t) => got.includes(t)).length;
  return got.length === 0 ? (want.length === 0 ? 1 : 0) : (right / want.length) * (right / got.length);
};
const flaky = score("flaky", (i, o) => (i.flaky ? exactly(i.flaky, o.flaky) : 1));
const tests = score("tests", (i, o) => {
  if (!i.tests) return 1;
  if (i.tests.length === 0) return Number(o.tests.length === 0);
  return i.tests.filter((t) => o.tests.includes(t)).length / i.tests.length;
});
const causes = score("causes", (i, o) => {
  if (!i.causes) return 1;
  const want = Object.entries(i.causes);
  return want.filter(([t, c]) => o.causes[t] === c).length / want.length;
});
const slow = score("slow", (_, o) => o.slow.length > 0 && !o.slow.includes("//:cached") ? 1 : 0);
const regressed = score("regressed", (i, o) => {
  if (!i.regressed) return 1;
  const want = Object.keys(i.regressed), got = Object.keys(o.regressed);
  const timeouts = want.filter((t) => o.regressed[t] === i.regressed![t]).length / want.length;
  return exactly(want, got) * timeouts;
});

// A checkout gives every fixture file one mtime; a fixture's times.json, when
// it has one, sets each run's time on a copy.
function results(fixture: string, scratch: string): string {
  const dir = join(here, fixture);
  let times: Record<string, string>;
  try {
    times = JSON.parse(readFileSync(join(dir, "times.json"), "utf8"));
  } catch {
    return dir;
  }
  const copy = join(scratch, "results");
  cpSync(dir, copy, { recursive: true });
  for (const [id, at] of Object.entries(times)) utimesSync(join(copy, `${id}-graph.json`), new Date(at), new Date(at));
  return copy;
}

async function report(input: Input): Promise<Output> {
  const scratch = mkdtempSync(join(tmpdir(), "ci-health-eval-"));
  const run = join(scratch, "run");
  try {
    const exit = await execute({ run, results: results(input.fixture, scratch), since: "", split: input.split });
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    const read = (step: string) => JSON.parse(readFileSync(join(run, `${step}.json`), "utf8"));
    const result = read("report"), analysis = read("analyze");
    const top = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      flaky: result.flaky,
      tests: result.tests,
      slow: result.slow,
      causes: Object.fromEntries(analysis.flaky.map((t: { label: string; causes: Record<string, number> }) => [t.label, top(t.causes)])),
      regressed: Object.fromEntries(analysis.regressed.map((t: { label: string; timeouts: number }) => [t.label, t.timeouts]))
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const output = await report(suiteCase.input as Input);
    console.log(`ci-health eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    return { output, stepKey: stepKey(suiteCase.name, here), latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "ci-health",
    cases,
    bindings: [flaky, tests, causes, slow, regressed].map((scorer) => Binding.make({ scorer, appliesTo: target })),
    concurrency: 1
  });
  const run = yield* Runner.run(suite, { runId: `ci-health-${Date.now()}`, at: new Date().toISOString() });
  if (process.argv.includes("--update")) {
    if (run.cases.some((result) => result.error !== undefined)) return yield* Effect.die("a case did not finish; no baseline recorded");
    writeFileSync(baselineFile, Baseline.write(yield* Baseline.fromRun(run)));
    console.log("ci-health eval: baseline recorded");
    return 0;
  }
  const comparison = yield* Regression.compare(yield* Baseline.load(readFileSync(baselineFile, "utf8")), run);
  console.log(Report.markdown(comparison));
  const { exitCode, summary } = Gate.ciGrade(yield* Gate.check(comparison, { mean: 1 }));
  console.log(summary);
  return exitCode;
}).pipe(Effect.provide(Layer.succeed(CaseExecutor.CaseExecutor)(executor)));

process.exitCode = await Effect.runPromise(program);
