// The effect-bump flow's eval: it runs the flow, unmocked, on a fresh jj
// workspace of this repository and moves it to an Effect version whose
// differences from the pin are known, then scores the report against them.
// 4.0.6 is the version before the 4.1.0 pin: the 4.1.0 bump (lane effect-41)
// had to change the root and subpath name tables, which their tests compare
// with the installed Effect, so the report must name both tests.
//
//   bun .smithers/flows/effect-bump/eval.ts            run, compare with baseline.json, exit 1 on a drop
//   bun .smithers/flows/effect-bump/eval.ts --update   run and record baseline.json
//
// A run installs Effect, builds the runtime and the compiler and runs Go
// tests: about 10 minutes on an idle host. EFFECT_BUMP_KEEP=1 keeps the
// workspace and the run directory.
import { Baseline, CaseExecutor, Gate, Regression, Report, Runner, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect, Exit, Layer } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "./run.ts";
import { stepKey } from "../step-key.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, "../../..");
const baselineFile = join(here, "baseline.json");
const target = { name: "effect-bump" };

type Input = { readonly version: string; readonly mustFail: ReadonlyArray<string> };
type Output = { readonly pinned: number; readonly failing: ReadonlyArray<string>; readonly pinsPass: boolean; readonly error?: string };

const cases = [
  {
    name: "effect-4.0.6",
    input: { version: "4.0.6", mustFail: ["TestEffectRootNamesMatchEffect", "TestEffectSubpathNamesMatchEffect"] } satisfies Input
  }
];

/** found: the share of the known differences the report names. */
const found = Scorer.make({
  id: "effect-bump/found",
  version: "1",
  name: "found",
  score: ({ input, output }) => Effect.succeed({
    score: (input as Input).mustFail.filter((name) => (output as Output).failing.includes(name)).length / (input as Input).mustFail.length
  })
});

/** pinned: the flow moved the manifests and left none behind. */
const pinned = Scorer.make({
  id: "effect-bump/pinned",
  version: "1",
  name: "pinned",
  score: ({ output }) => Effect.succeed({ score: (output as Output).pinned > 500 && (output as Output).pinsPass ? 1 : 0 })
});

function bumpFresh(input: Input): Promise<Output> {
  const name = `effect-bump-eval-${process.pid}`;
  const scratch = mkdtempSync(join(tmpdir(), "effect-bump-eval-"));
  const workspace = join(scratch, "repo"), run = join(scratch, "run");
  const jj = (...args: Array<string>) => execFileSync("jj", args, { cwd: repository, stdio: "pipe" });
  jj("workspace", "add", workspace, "--name", name, "-r", "@");
  const cleanup = () => {
    if (process.env.EFFECT_BUMP_KEEP) return console.log(`effect-bump eval: kept ${scratch}`);
    try { jj("workspace", "forget", name); } catch {}
    rmSync(scratch, { recursive: true, force: true });
  };
  return execute({ run, repo: workspace, version: input.version }).then((exit) => {
    const read = (step: string) => existsSync(join(run, `${step}.json`)) ? JSON.parse(readFileSync(join(run, `${step}.json`), "utf8")) : undefined;
    const probe = read("probe");
    const output: Output = {
      pinned: read("pin")?.files ?? 0,
      failing: read("report")?.failing ?? [],
      pinsPass: probe?.results?.find((r: { name: string }) => r.name === "pins")?.code === 0,
      ...(Exit.isFailure(exit) ? { error: String(exit.cause) } : {})
    };
    cleanup();
    return output;
  }, (error) => { cleanup(); throw error; });
}

// A flow that stops before its report is a failed case, never a score: the
// runner records it as an error, and --update refuses to record a baseline.
const executor = CaseExecutor.make((suiteCase) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const output = await bumpFresh(suiteCase.input as Input);
    console.log(`effect-bump eval: ${suiteCase.name}: ${JSON.stringify(output)}`);
    if (output.error !== undefined) throw new Error(output.error);
    return { output, stepKey: stepKey(suiteCase.name, here), latencyMs: Date.now() - started, target };
  })
);

const program = Effect.gen(function* () {
  const suite = yield* Suite.make({
    name: "effect-bump",
    cases,
    bindings: [Binding.make({ scorer: found, appliesTo: target }), Binding.make({ scorer: pinned, appliesTo: target })],
    concurrency: 1
  });
  const run = yield* Runner.run(suite, { runId: `effect-bump-${Date.now()}`, at: new Date().toISOString() });
  if (process.argv.includes("--update")) {
    if (run.cases.some((result) => result.error !== undefined)) return yield* Effect.die("a case did not finish; no baseline recorded");
    writeFileSync(baselineFile, Baseline.write(yield* Baseline.fromRun(run)));
    console.log("effect-bump eval: baseline recorded");
    return 0;
  }
  const comparison = yield* Regression.compare(yield* Baseline.load(readFileSync(baselineFile, "utf8")), run);
  console.log(Report.markdown(comparison));
  const { exitCode, summary } = Gate.ciGrade(yield* Gate.check(comparison, { mean: 1 }));
  console.log(summary);
  return exitCode;
}).pipe(Effect.provide(Layer.succeed(CaseExecutor.CaseExecutor)(executor)));

process.exitCode = await Effect.runPromise(program);
