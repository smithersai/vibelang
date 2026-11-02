import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { flowStep } from "./lib/steps.mjs";

// One execution migrates the next batch of a run: it upgrades Effect, sets the
// run up and plans it the first time, then codemods, compiles, repairs,
// verifies and records one batch, then reports. Every step reads and writes
// the run directory, so a failed execution resumes where it stopped, and
// step.mjs runs the same steps one at a time. README.md describes the run
// directory and the agent seam.

const implementationVersion = "migrate/v1";

const Outcome = Schema.Struct({ step: Schema.String, batch: Schema.String, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

const SetupPayload = {
  run: Schema.String,
  target: Schema.String,
  packages: Schema.Array(Schema.String),
  emittedProjects: Schema.optional(Schema.Array(Schema.String)),
  test: Schema.String,
  main: Schema.optional(Schema.String),
  afterConvert: Schema.optional(Schema.Array(Schema.String)),
  measureCommand: Schema.optional(Schema.String),
  testCwd: Schema.String,
  toolchain: Schema.String
};
/** A scope file (one repository-relative module per line) plans one whole-scope pass, which needs no agent. */
const FlowPayload = { ...SetupPayload, scope: Schema.optional(Schema.String) };
const RunPayload = { run: Schema.String };
const PlanPayload = { run: Schema.String, scope: Schema.optional(Schema.String) };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const UpgradeEffect = declare("migrate/UpgradeEffect", SetupPayload);
export const Setup = declare("migrate/Setup", RunPayload);
export const Plan = declare("migrate/Plan", PlanPayload);
export const Codemod = declare("migrate/Codemod", RunPayload);
export const Compile = declare("migrate/Compile", RunPayload);
export const Repair = declare("migrate/Repair", RunPayload);
export const Verify = declare("migrate/Verify", RunPayload);
export const Record = declare("migrate/Record", RunPayload);
export const Report = declare("migrate/Report", RunPayload);

/** The agent the plan and repair steps call: a command that reads its prompt on stdin, such as a coding agent's non-interactive mode. */
const agent = Config.option(Config.NonEmptyString("MIGRATE_AGENT"));

const step = (name: string, options: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () => flowStep(name, options),
    catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) })
  });

const withAgent = (name: string, options: { readonly run: string; readonly scope?: string | undefined }) =>
  Effect.flatMap(Effect.orDie(agent), (command) => step(name, { ...options, agent: Option.getOrUndefined(command) }));

/** The steps' implementations, which the flow's host composes. */
export const layer = Layer.mergeAll(
  UpgradeEffect.toLayer(({ packages, ...input }) => step("upgrade-effect", { ...input, packages: [...packages] }), { implementationVersion }),
  Setup.toLayer(({ run }) => step("setup", { run }), { implementationVersion }),
  Plan.toLayer((input) => withAgent("plan", input), { implementationVersion }),
  Codemod.toLayer(({ run }) => step("codemod", { run }), { implementationVersion }),
  Compile.toLayer(({ run }) => step("compile", { run }), { implementationVersion }),
  Repair.toLayer(({ run }) => withAgent("repair", { run }), { implementationVersion }),
  Verify.toLayer(({ run }) => step("verify", { run }), { implementationVersion }),
  Record.toLayer(({ run }) => step("record", { run }), { implementationVersion }),
  Report.toLayer(({ run }) => step("report", { run }), { implementationVersion })
);

export default Flow.make("migrate", {
  description: "Migrate an Effect TypeScript codebase to idiomatic VibeLang, one planned batch per execution: upgrade Effect and set VibeLang up first, then codemod, compile, agent repair, verify against the baseline tests and declarations, commit",
  capabilities: [],
  // The steps change the target repository and the run directory the payload
  // names, both outside this repository, so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: FlowPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, ({ scope, ...input }: Schema.Struct.Type<typeof FlowPayload>) => {
    const run = { run: input.run };
    return UpgradeEffect.call(input).pipe(
      Node.andThen(Setup.call(run)),
      Node.andThen(Plan.call(scope === undefined ? run : { ...run, scope })),
      Node.andThen(Codemod.call(run)),
      Node.andThen(Compile.call(run)),
      Node.andThen(Repair.call(run)),
      Node.andThen(Verify.call(run)),
      Node.andThen(Record.call(run)),
      Node.andThen(Report.call(run))
    );
  })
});
