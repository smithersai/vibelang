// The first-bad flow's eval: it runs the flow, unmocked, on two real post-merge
// RED reports from VibeLang's own main, in a jj workspace of this repository,
// and scores its answers against what was established by hand:
//
// - match-error-tags: post-merge's graph results show
//   //typescript/vibelang:decl-error-family and :match-class-patterns passing
//   on main 8b4abee2dbae and failing on the next main, f6fe7a68d976, and on the
//   seven after it. By hand: both fail at f6fe7a68d976 ("fix(match): recover
//   cross-package error tag matching (VIP-13)", which changes the runtime's
//   match prelude) and pass at its parent, 8938ad232196; decl-error-family
//   prints family [true,false,false,false] where it wants all true.
// - do-contextual-result: post-merge reported //:go-vibelangfuzz RED on main
//   c9b86d733a10 at 17:17Z on 2026-11-02 (TestDoContextualResult and its
//   subtests); 5e496f0dc5ec passed it. By hand: 00b2aa8370ee ("test(fuzz):
//   contextually type the alternatives a do expression contributes") adds the
//   test and fails it; its parent has no such test. Bisection runs only that
//   test at each commit (narrowed), not the whole target.
// - load-timeouts: post-merge reported two case targets RED on main
//   bd9b5e296a19 at 06:10Z on 2026-11-01; both were spawn timeouts at load 269,
//   and the same main went GREEN on a quieter host at 06:19Z. No commit broke
//   them: the flow must not blame one.
//
// Scorers: state, each target's state is the known one; culprit, the first bad
// commit is the known one, and none is blamed when nothing broke; tests, the
// report names the failing tests at the first bad commit; runs, bisection took
// one run at good plus at most log2 of the commits; narrowed, every run of a Go
// target ran only its failing tests, from the RED line at bad and from bad after.
//
//   bun .smithers/flows/first-bad/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/first-bad/eval.ts --update   run and record baseline.json
//
// Run it from a jj workspace of the repository: the flow adds its own
// workspaces beside the run directory and removes them when it finishes.
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "./run.ts";
import { stepKey } from "../step-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const baselineFile = join(here, "baseline.json");
const target = { name: "first-bad" };

type Input = {
  readonly good: string;
  readonly bad: string;
  readonly states: Readonly<Record<string, string>>;
  readonly firstBad: Readonly<Record<string, string>>;
  readonly tests: ReadonlyArray<string>;
  // The failing tests the RED line named, as pm-first-bad.py passes them.
  readonly red?: Readonly<Record<string, ReadonlyArray<string>>>;
};
type Output = {
  readonly states: Readonly<Record<string, string>>;
  readonly firstBad: Readonly<Record<string, string>>;
  readonly tests: ReadonlyArray<string>;
  readonly commits: number;
  readonly bisectRuns: number;
  readonly narrowed: boolean;
};

const cases = [
  {
    name: "match-error-tags",
    input: {
      good: "8b4abee2dbae",
      bad: "f6fe7a68d976",
      states: { "//typescript/vibelang:decl-error-family": "broken", "//typescript/vibelang:match-class-patterns": "broken" },
      firstBad: { "//typescript/vibelang:decl-error-family": "f6fe7a68d976", "//typescript/vibelang:match-class-patterns": "f6fe7a68d976" },
      tests: ["decl-error-family", "match-class-patterns"]
    } satisfies Input
  },
  {
    name: "do-contextual-result",
    input: {
      good: "5e496f0dc5ec",
      bad: "c9b86d733a10",
      states: { "//:go-vibelangfuzz": "broken" },
      firstBad: { "//:go-vibelangfuzz": "00b2aa8370ee" },
      tests: ["TestDoContextualResult"],
      red: { "//:go-vibelangfuzz": ["TestDoContextualResult"] }
    } satisfies Input
  },
  {
    name: "load-timeouts",
    input: {
      good: "9d38528780b3",
      bad: "bd9b5e296a19",
      states: { "//typescript/vibelang:by-name-optional-field": "not-reproduced", "//typescript/vibelang:constrained-destinations_fail": "not-reproduced" },
      firstBad: {},
      tests: []
    } satisfies Input
  }
];

const score = (id: string, f: (input: Input, output: Output) => number) =>
  Scorer.make({ id: `first-bad/${id}`, version: "1", name: id, score: ({ input, output }) => Effect.succeed({ score: f(input as Input, output as Output) }) });

const state = score("state", (i, o) => {
  const want = Object.entries(i.states);
  return want.filter(([t, s]) => o.states[t] === s).length / want.length;
});
const culprit = score("culprit", (i, o) => {
  const want = Object.entries(i.firstBad);
  const blamed = Object.keys(o.firstBad);
  if (want.length === 0) return blamed.length === 0 ? 1 : 0;
  return want.filter(([t, c]) => o.firstBad[t]?.startsWith(c)).length / Math.max(want.length, blamed.length);
});
const tests = score("tests", (i, o) => (i.tests.length === 0 ? 1 : i.tests.filter((t) => o.tests.includes(t)).length / i.tests.length));
const runs = score("runs", (_, o) => (o.bisectRuns <= 1 + Math.ceil(Math.log2(o.commits)) ? 1 : 0));
// Every run of a Go target ran only the tests post-merge named (reproduce) or
// that failed at bad (bisect).
const narrowed = score("narrowed", (_, o) => (o.narrowed ? 1 : 0));

async function answer(input: Input): Promise<Output> {
  const run = mkdtempSync(join(tmpdir(), "first-bad-eval-"));
  try {
    const targets = Object.keys(input.states);
    const exit = await execute({ run, repo, good: input.good, bad: input.bad, targets: targets.join(" "), tries: 3, jobs: 8,
      tests: Object.entries(input.red ?? {}).map(([t, names]) => `${t}=${names.join(",")}`).join(" ") });
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    const read = (step: string) => JSON.parse(readFileSync(join(run, `${step}.json`), "utf8"));
    const found = read("report").targets as Record<string, { state: string; firstBad?: string; tests?: ReadonlyArray<string> }>;
    return {
      states: Object.fromEntries(Object.entries(found).map(([t, e]) => [t, e.state])),
      firstBad: Object.fromEntries(Object.entries(found).filter(([, e]) => e.firstBad).map(([t, e]) => [t, e.firstBad!])),
      tests: Object.values(found).flatMap((e) => (e.firstBad ? e.tests ?? [] : [])),
      commits: read("prepare").commits.length,
      bisectRuns: read("bisect").runs.length,
      narrowed: ([...read("reproduce").runs, ...read("bisect").runs] as ReadonlyArray<{ targets: Record<string, { narrowed?: ReadonlyArray<string> }> }>).every((r) =>
        Object.entries(r.targets).every(([t, e]) => !t.startsWith("//:go-") || (e.narrowed?.length ?? 0) > 0))
    };
  } finally {
    rmSync(run, { recursive: true, force: true });
  }
}

const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const output = await answer(suiteCase.input as Input);
    console.log(`first-bad eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    return { output, stepKey: stepKey(suiteCase.name, here, join(here, "../ci-health")), latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "first-bad",
    cases,
    bindings: [state, culprit, tests, runs, narrowed].map((scorer) => Binding.make({ scorer, appliesTo: target })),
    concurrency: 1
  });
  const run = yield* Runner.run(suite, { runId: `first-bad-${Date.now()}`, at: new Date().toISOString() });
  if (process.argv.includes("--update")) {
    if (run.cases.some((result) => result.error !== undefined)) return yield* Effect.die("a case did not finish; no baseline recorded");
    writeFileSync(baselineFile, Baseline.write(yield* Baseline.fromRun(run)));
    console.log("first-bad eval: baseline recorded");
    return 0;
  }
  const comparison = yield* Regression.compare(yield* Baseline.load(readFileSync(baselineFile, "utf8")), run);
  console.log(Report.markdown(comparison));
  const { exitCode, summary } = Gate.ciGrade(yield* Gate.check(comparison, { mean: 1 }));
  console.log(summary);
  return exitCode;
}).pipe(Effect.provide(Layer.succeed(CaseExecutor.CaseExecutor)(executor)));

process.exitCode = await Effect.runPromise(program);
