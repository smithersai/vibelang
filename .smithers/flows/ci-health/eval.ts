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
// Scorers: flaky, exactly the flaky targets; tests, the known flaky tests are
// named; causes, each target's top cause; slow, a replay never ranks as slow.
//
//   bun .smithers/flows/ci-health/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/ci-health/eval.ts --update   run and record baseline.json
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "./run.ts";

const here = dirname(fileURLToPath(import.meta.url));
const baselineFile = join(here, "baseline.json");
const target = { name: "ci-health" };

type Input = { readonly flaky: ReadonlyArray<string>; readonly tests: ReadonlyArray<string>; readonly causes: Readonly<Record<string, string>> };
type Output = {
  readonly flaky: ReadonlyArray<string>;
  readonly tests: ReadonlyArray<string>;
  readonly causes: Readonly<Record<string, string>>;
  readonly slow: ReadonlyArray<string>;
};

const cases = [{
  name: "real-runs",
  input: {
    flaky: ["//:docs-tools", "//packages:compiler-test", "//packages:unplugin-test"],
    tests: [
      "isolates run-mode output across projects when the second has a warning",
      "paths-imports: a paths alias resolves to the file the compiler resolves it to",
      "rollup: watch mode recompiles on .vibe, .ts and tsconfig changes"
    ],
    causes: { "//:docs-tools": "timeout", "//packages:unplugin-test": "timeout", "//packages:compiler-test": "property counterexample" }
  } satisfies Input
}];

const score = (id: string, f: (input: Input, output: Output) => number) =>
  Scorer.make({ id: `ci-health/${id}`, version: "1", name: id, score: ({ input, output }) => Effect.succeed({ score: f(input as Input, output as Output) }) });

const flaky = score("flaky", (i, o) => {
  const right = i.flaky.filter((t) => o.flaky.includes(t)).length;
  return o.flaky.length === 0 ? 0 : (right / i.flaky.length) * (right / o.flaky.length);
});
const tests = score("tests", (i, o) => i.tests.filter((t) => o.tests.includes(t)).length / i.tests.length);
const causes = score("causes", (i, o) => {
  const want = Object.entries(i.causes);
  return want.filter(([t, c]) => o.causes[t] === c).length / want.length;
});
const slow = score("slow", (_, o) => o.slow.length > 0 && !o.slow.includes("//:cached") ? 1 : 0);

async function report(): Promise<Output> {
  const run = mkdtempSync(join(tmpdir(), "ci-health-eval-"));
  try {
    const exit = await execute({ run, results: join(here, "fixture"), since: "" });
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    const read = (step: string) => JSON.parse(readFileSync(join(run, `${step}.json`), "utf8"));
    const result = read("report"), analysis = read("analyze");
    const top = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      flaky: result.flaky,
      tests: result.tests,
      slow: result.slow,
      causes: Object.fromEntries(analysis.flaky.map((t: { label: string; causes: Record<string, number> }) => [t.label, top(t.causes)]))
    };
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
}

const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const output = await report();
    console.log(`ci-health eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    return { output, stepKey: suiteCase.name, latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "ci-health",
    cases,
    bindings: [flaky, tests, causes, slow].map((scorer) => Binding.make({ scorer, appliesTo: target })),
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
