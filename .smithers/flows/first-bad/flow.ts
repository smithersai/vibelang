import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { parseTests, run as steps, start } from "./lib/steps.mjs";

// One execution answers: which of these targets, failing at bad, did a commit
// after good break, and which commit? Each step reads and writes the run
// directory, so a stopped execution resumes where it stopped. No step calls a
// model. README.md describes the run.

const implementationVersion = "first-bad/v1";

const Outcome = Schema.Struct({ step: Schema.String, ok: Schema.Boolean, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

// targets: graph labels, space-separated. tries: runs at bad before a failing
// target counts as broken rather than flaky. jobs: --jobs for scripts/ci.sh.
// tests: "<target>=<Test>,<Test> ...", the failing tests to run alone in a Go
// target at every commit; "" runs every target whole at bad.
const StartPayload = {
  run: Schema.String,
  repo: Schema.String,
  good: Schema.String,
  bad: Schema.String,
  targets: Schema.String,
  tries: Schema.Number,
  jobs: Schema.Number,
  tests: Schema.String
};
const RunPayload = { run: Schema.String };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Prepare = declare("first-bad/Prepare", StartPayload);
export const Reproduce = declare("first-bad/Reproduce", RunPayload);
export const Bisect = declare("first-bad/Bisect", RunPayload);
export const Report = declare("first-bad/Report", RunPayload);

const step = (name: keyof typeof steps, run: string) =>
  Effect.try({
    try: () => {
      const result = steps[name](run) as { ok: boolean; summary: string };
      return { step: name, ok: result.ok, summary: result.summary };
    },
    catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) })
  });

const begin = (input: Schema.Struct.Type<typeof StartPayload>) =>
  Effect.try({
    try: () => start(input.run, { ...input, targets: input.targets.split(/\s+/).filter(Boolean), tests: parseTests(input.tests) }),
    catch: (error) => new StepFailed({ step: "prepare", message: error instanceof Error ? error.message : String(error) })
  });

/** The steps' implementations, which the flow's host composes. */
export const layer = Layer.mergeAll(
  Prepare.toLayer((input) => begin(input).pipe(Effect.andThen(step("prepare", input.run))), { implementationVersion }),
  Reproduce.toLayer(({ run }) => step("reproduce", run), { implementationVersion }),
  Bisect.toLayer(({ run }) => step("bisect", run), { implementationVersion }),
  Report.toLayer(({ run }) => step("report", run), { implementationVersion })
);

export default Flow.make("first-bad", {
  description: "Rerun the graph targets that fail at a bad commit, then bisect the ones that reproduce to the first commit after a good one that fails them",
  capabilities: [],
  // The steps write the run directory and a jj workspace inside it, both named
  // by the payload, so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) => {
    const run = { run: input.run };
    return Prepare.call(input).pipe(Node.andThen(Reproduce.call(run)), Node.andThen(Bisect.call(run)), Node.andThen(Report.call(run)));
  })
});
