import { CaseExecutor, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect } from "effect";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BENCHMARK_VERSION, TASKS } from "./agent-evals/benchmark-30/index.mjs";
import { resolveBenchmarkToolchain, verifySingleTask } from "./agent-evals/benchmark-30/verify.mjs";

// Deterministic 30-task public AI agent reliability benchmark suite:
// Verifies across 6 categories (5 tasks each = 30 tasks x 3 modes = 90 cases):
// - `<id>/vibe-reference`: idiomatic .vibe reference compiles and matches expected output
// - `<id>/effect-ts-reference`: idiomatic Effect 4 .ts reference compiles and matches expected output
// - `<id>/fault-control`: realistic injected LLM mistake fails at compile time or runtime
// Kept alongside agent-evals.eval.ts so the 4-task baseline remains unchanged.

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

type Mode = "vibe-reference" | "effect-ts-reference" | "fault-control";
type CaseInput = { readonly taskId: string; readonly category: string; readonly mode: Mode };
type CaseOutput = {
  readonly taskId: string;
  readonly mode: Mode;
  readonly pass: boolean;
  readonly stage: string;
  readonly detail: string;
};

const target = { name: "agent-evals-benchmark-30" };

const scorer = Scorer.make({
  id: "agent-evals-benchmark-30/check",
  version: "1",
  name: "pass",
  score: ({ output }) => {
    const actual = output as CaseOutput;
    return Effect.succeed({
      score: actual.pass ? 1 : 0,
      meta: {
        taskId: actual.taskId,
        mode: actual.mode,
        stage: actual.stage,
        detail: actual.detail,
      },
    });
  },
});

const modes: readonly Mode[] = ["vibe-reference", "effect-ts-reference", "fault-control"];

const cases = TASKS.flatMap((task) =>
  modes.map((mode) => ({
    name: `${task.id}/${mode}`,
    input: { taskId: task.id, category: task.category, mode } satisfies CaseInput,
  }))
);

export const suite = Suite.make({
  name: "agent-evals-benchmark-30",
  cases,
  bindings: [Binding.make({ scorer, appliesTo: target })],
  concurrency: 4,
});

export const executor = CaseExecutor.make((c) =>
  Effect.tryPromise(async () => {
    const started = Date.now();
    const input = c.input as CaseInput;
    const task = TASKS.find((t) => t.id === input.taskId);
    if (!task) throw new Error(`benchmark-30: unknown task ${input.taskId}`);
    const toolchain = resolveBenchmarkToolchain(repo);
    const result = await verifySingleTask(task, input.mode, toolchain);
    const stepKey = createHash("sha256")
      .update(JSON.stringify({ version: BENCHMARK_VERSION, task, mode: input.mode }))
      .digest("hex");
    return {
      output: result as CaseOutput,
      stepKey,
      latencyMs: Date.now() - started,
      target,
    };
  })
);
