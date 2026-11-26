import { CaseExecutor, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect } from "effect";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeWorkdir, listTasks, prepareWorkdir, stepKeyFor } from "./agent-evals/lib.mjs";

// Deterministic agent-evals regression suite (#466):
// Runs no coding agent. Verifies that for every task in scripts/agent-evals/tasks/:
// - `<task>/reference` compiles and passes the task's test suite (`pass: true`)
// - `<task>/base` (untouched sample) fails (`pass: false`)
// Wired into //:agent-evals so `smthrs ci` catches stale samples or broken tasks.

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

type CaseInput = { readonly task: string; readonly mode: "base" | "reference"; readonly expectedPass: boolean };
type CaseOutput = {
  readonly task: string;
  readonly mode: "base" | "reference";
  readonly pass: boolean;
  readonly compiles: boolean;
  readonly testsPass: boolean;
  readonly testsUnchanged: boolean;
  readonly compileOutput: string;
  readonly testOutput: string;
};

const target = { name: "agent-evals" };

const scorer = Scorer.make({
  id: "agent-evals/expectation",
  version: "1",
  name: "pass",
  score: ({ input, output }) => {
    const c = input as CaseInput;
    const actual = output as CaseOutput;
    return Effect.succeed({
      score: actual.pass === c.expectedPass ? 1 : 0,
      meta: {
        task: c.task,
        mode: c.mode,
        expectedPass: c.expectedPass,
        pass: actual.pass,
        compiles: actual.compiles,
        testsPass: actual.testsPass,
        testsUnchanged: actual.testsUnchanged
      }
    });
  }
});

const cases = listTasks(repo).flatMap((task) => [
  { name: `${task}/base`, input: { task, mode: "base" as const, expectedPass: false } },
  { name: `${task}/reference`, input: { task, mode: "reference" as const, expectedPass: true } }
]);

export const suite = Suite.make({
  name: "agent-evals",
  cases,
  bindings: [Binding.make({ scorer, appliesTo: target })],
  concurrency: 2
});

export const executor = CaseExecutor.make((c) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const input = c.input as CaseInput;
    const prepared = prepareWorkdir(repo, input.task, input.mode);
    try {
      const graded = gradeWorkdir(prepared.dir, prepared.spec, prepared.testDigestBefore, prepared.toolchain);
      const output: CaseOutput = {
        task: input.task,
        mode: input.mode,
        pass: graded.pass,
        compiles: graded.compiles,
        testsPass: graded.testsPass,
        testsUnchanged: graded.testsUnchanged,
        compileOutput: graded.compileOutput,
        testOutput: graded.testOutput
      };
      return {
        output,
        stepKey: stepKeyFor(repo, input.task, input.mode),
        latencyMs: Date.now() - started,
        target
      };
    } finally {
      rmSync(prepared.dir, { recursive: true, force: true });
    }
  })
);
