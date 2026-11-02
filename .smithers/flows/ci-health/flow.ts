import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { run as steps, start } from "./lib/steps.mjs";

// One execution reads the graph results and logs CI wrote and says which
// targets are slow, which got slower, which are flaky, and which tests and
// causes are behind them. Every step reads and writes the run directory, so a stopped execution
// resumes where it stopped. No step calls a model. README.md describes the run.

const implementationVersion = "ci-health/v2";

const Outcome = Schema.Struct({ step: Schema.String, ok: Schema.Boolean, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

// results: the directory of <id>-graph.json and <id>-graph.log files.
// since: an ISO time; older results are ignored. Empty reads every file.
// split: an ISO time; run times after it are compared with those before it
// (the slower targets). Empty splits at the middle run.
const StartPayload = { run: Schema.String, results: Schema.String, since: Schema.String, split: Schema.String };
const RunPayload = { run: Schema.String };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Collect = declare("ci-health/Collect", StartPayload);
export const Analyze = declare("ci-health/Analyze", RunPayload);
export const Report = declare("ci-health/Report", RunPayload);

const step = (name: keyof typeof steps, run: string) =>
  Effect.try({
    try: () => {
      const result = steps[name](run) as { ok: boolean; summary: string };
      return { step: name, ok: result.ok, summary: result.summary };
    },
    catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) })
  });

/** The steps' implementations, which the flow's host composes. */
export const layer = Layer.mergeAll(
  Collect.toLayer(({ run, results, since, split }) => Effect.sync(() => start(run, { results, since, split })).pipe(Effect.andThen(step("collect", run))), { implementationVersion }),
  Analyze.toLayer(({ run }) => step("analyze", run), { implementationVersion }),
  Report.toLayer(({ run }) => step("report", run), { implementationVersion })
);

export default Flow.make("ci-health", {
  description: "Rank the build graph's slow, slower and flaky targets from CI's results and logs, with the tests and causes behind each",
  capabilities: [],
  // The steps read the results directory and write the run directory the
  // payload names, so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) => {
    const run = { run: input.run };
    return Collect.call(input).pipe(Node.andThen(Analyze.call(run)), Node.andThen(Report.call(run)));
  })
});
