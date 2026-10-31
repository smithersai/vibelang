import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { run as steps, start } from "./lib/steps.mjs";

// One execution moves a VibeLang checkout to another Effect version and says
// what that breaks: pin every manifest and version literal, install, rebuild,
// run the checks that compare VibeLang's tables with the installed Effect,
// and write report.md. Every step reads and writes the run directory, so a
// failed execution resumes where it stopped. No step calls a model: the
// report is the input to the fix commits. README.md describes the run.

const implementationVersion = "effect-bump/v1";

const Outcome = Schema.Struct({ step: Schema.String, ok: Schema.Boolean, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

const StartPayload = { run: Schema.String, repo: Schema.String, version: Schema.String };
const RunPayload = { run: Schema.String };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Pin = declare("effect-bump/Pin", StartPayload);
export const Install = declare("effect-bump/Install", RunPayload);
export const Build = declare("effect-bump/Build", RunPayload);
export const Probe = declare("effect-bump/Probe", RunPayload);
export const Report = declare("effect-bump/Report", RunPayload);

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
  Pin.toLayer(({ run, repo, version }) => Effect.sync(() => start(run, { repo, version })).pipe(Effect.andThen(step("pin", run))), { implementationVersion }),
  Install.toLayer(({ run }) => step("install", run), { implementationVersion }),
  Build.toLayer(({ run }) => step("build", run), { implementationVersion }),
  Probe.toLayer(({ run }) => step("probe", run), { implementationVersion }),
  Report.toLayer(({ run }) => step("report", run), { implementationVersion })
);

export default Flow.make("effect-bump", {
  description: "Move a VibeLang checkout to another Effect version: pin, install, rebuild, run the checks that compare VibeLang with Effect, and report what to change",
  capabilities: [],
  // The steps change the checkout and the run directory the payload names,
  // so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) => {
    const run = { run: input.run };
    return Pin.call(input).pipe(
      Node.andThen(Install.call(run)),
      Node.andThen(Build.call(run)),
      Node.andThen(Probe.call(run)),
      Node.andThen(Report.call(run))
    );
  })
});
