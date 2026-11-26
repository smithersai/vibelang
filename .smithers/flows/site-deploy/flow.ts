import { Action, Flow } from "@smthrs/flow";
import { Node } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { run as steps, start } from "./lib/steps.mjs";

// Durable site-deploy flow replacing nyc-01:~/vibe/site-autodeploy-v4.sh and
// its three retry/state files (#476). Checks whether main@github or published
// npm `vibelang` version moved since the last recorded deploy, updates a
// dedicated jj workspace under `state`, regenerates docs, runs deploy-docs.sh
// (passing credentials ONLY to that child process), and records success.

const implementationVersion = "site-deploy/v1";

const Outcome = Schema.Struct({
  step: Schema.String,
  ok: Schema.Boolean,
  skipped: Schema.Boolean,
  summary: Schema.String
});

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", {
  step: Schema.String,
  message: Schema.String
}) {}

const StartPayload = {
  state: Schema.String,
  repo: Schema.optional(Schema.String),
  revision: Schema.optional(Schema.String),
  credentials: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  force: Schema.optional(Schema.Boolean),
  workspaceName: Schema.optional(Schema.String),
  mainCmd: Schema.optional(Schema.String),
  npmCmd: Schema.optional(Schema.String),
  checkoutCmd: Schema.optional(Schema.String),
  regenerateCmd: Schema.optional(Schema.String),
  deployCmd: Schema.optional(Schema.String)
};
const StatePayload = { state: Schema.String };

const declare = <const Tag extends string, P extends Schema.Struct.Fields>(tag: Tag, payload: P) =>
  Action.make(tag, { implementationVersion, payload, success: Outcome, error: StepFailed });

export const Check = declare("site-deploy/Check", StartPayload);
export const Checkout = declare("site-deploy/Checkout", StatePayload);
export const Regenerate = declare("site-deploy/Regenerate", StatePayload);
export const Deploy = declare("site-deploy/Deploy", StatePayload);
export const Record = declare("site-deploy/Record", StatePayload);

const step = (name: keyof typeof steps, state: string) =>
  Effect.try({
    try: () => {
      const result = steps[name](state) as { ok: boolean; skipped?: boolean; summary: string };
      return { step: name, ok: result.ok, skipped: Boolean(result.skipped), summary: result.summary };
    },
    catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) })
  });

/** The steps' implementations, which the durable host composes. */
export const layer = Layer.mergeAll(
  Check.toLayer(
    (input) =>
      Effect.try({
        try: () => start(input.state, input),
        catch: (error) => new StepFailed({ step: "check", message: error instanceof Error ? error.message : String(error) })
      }).pipe(Effect.andThen(step("check", input.state))),
    { implementationVersion }
  ),
  Checkout.toLayer(({ state }) => step("checkout", state), { implementationVersion }),
  Regenerate.toLayer(({ state }) => step("regenerate", state), { implementationVersion }),
  Deploy.toLayer(({ state }) => step("deploy", state), { implementationVersion }),
  Record.toLayer(({ state }) => step("record", state), { implementationVersion })
);

export default Flow.make("site-deploy", {
  description: "Deploy vibelang.sh from an isolated jj workspace whenever main@github or published npm vibelang version changes",
  capabilities: [],
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: StartPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof StartPayload>) => {
    const state = { state: input.state };
    return Check.call(input).pipe(
      Node.andThen(Checkout.call(state)),
      Node.andThen(Regenerate.call(state)),
      Node.andThen(Deploy.call(state)),
      Node.andThen(Record.call(state))
    );
  })
});
