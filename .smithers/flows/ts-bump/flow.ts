import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { run as steps, start } from "./lib/steps.mjs";

// One execution moves the fork in typescript/ to a newer upstream
// microsoft/TypeScript commit and says what that breaks: download the pinned
// and the target trees, merge upstream's changes into typescript/ three ways,
// move the pin, regenerate the vendored Effect rules' diagnostics and shims,
// build, run the graph targets that cover the fork, and write report.md.
// Every step reads and writes the run directory, so a failed execution
// resumes where it stopped. No step calls a model: the report is the input to
// the fix commits. README.md describes the run.

const implementationVersion = "ts-bump/v1";

const Outcome = Schema.Struct({ step: Schema.String, ok: Schema.Boolean, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

// to: a commit, or an npm dist-tag or version of `typescript` whose gitHead
// is the commit. targets: graph target patterns, space-separated; empty runs
// the default set (lib/steps.mjs TARGETS).
const StartPayload = { run: Schema.String, repo: Schema.String, to: Schema.String, targets: Schema.String };
const RunPayload = { run: Schema.String };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Fetch = declare("ts-bump/Fetch", StartPayload);
export const Merge = declare("ts-bump/Merge", RunPayload);
export const Regenerate = declare("ts-bump/Regenerate", RunPayload);
export const Build = declare("ts-bump/Build", RunPayload);
export const Probe = declare("ts-bump/Probe", RunPayload);
export const Report = declare("ts-bump/Report", RunPayload);

const step = (name: keyof typeof steps, run: string) =>
  Effect.try({
    try: () => {
      const result = steps[name](run) as { ok: boolean; summary: string };
      return { step: name, ok: result.ok, summary: result.summary };
    },
    catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) })
  });

const options = ({ repo, to, targets }: { repo: string; to: string; targets: string }) =>
  ({ repo, to, ...(targets.trim() ? { targets: targets.trim().split(/\s+/) } : {}) });

/** The steps' implementations, which the flow's host composes. */
export const layer = Layer.mergeAll(
  Fetch.toLayer((input) => Effect.sync(() => start(input.run, options(input))).pipe(Effect.andThen(step("fetch", input.run))), { implementationVersion }),
  Merge.toLayer(({ run }) => step("merge", run), { implementationVersion }),
  Regenerate.toLayer(({ run }) => step("regenerate", run), { implementationVersion }),
  Build.toLayer(({ run }) => step("build", run), { implementationVersion }),
  Probe.toLayer(({ run }) => step("probe", run), { implementationVersion }),
  Report.toLayer(({ run }) => step("report", run), { implementationVersion })
);

export default Flow.make("ts-bump", {
  description: "Move the TypeScript fork to a newer upstream commit: merge upstream's changes three ways, move the pin, regenerate the Effect rules' shims, build, run the fork's targets, and report what to change",
  capabilities: [],
  // The steps change the checkout and the run directory the payload names,
  // so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) => {
    const run = { run: input.run };
    return Fetch.call(input).pipe(
      Node.andThen(Merge.call(run)),
      Node.andThen(Regenerate.call(run)),
      Node.andThen(Build.call(run)),
      Node.andThen(Probe.call(run)),
      Node.andThen(Report.call(run))
    );
  })
});
