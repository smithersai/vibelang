import { Action, Flow } from "@smthrs/flow";
import { Panel } from "@smthrs/patterns";
import { Node } from "@smthrs/plan";
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect";
import { ask, prepare, record, REVIEWERS, settle, snapshot } from "./lib/steps.mjs";

// One execution runs the specification's acceptance gate on one revision: it
// exports the specification as that commit has it, asks the four reviewers to
// grade it as a Panel, and records each verdict and grade. Each step reads and
// writes the run directory, so a stopped execution resumes where it stopped and
// asks only the reviewers that have not answered. README.md describes the run.

const implementationVersion = "spec-review/v1";

/** What one reviewer said. The verdict "none" means it failed or its answer could not be read; problem says why. */
export const Opinion = Schema.Struct({
  reviewer: Schema.String,
  verdict: Schema.Literals(["LGTM", "CHANGES", "none"]),
  grade: Schema.String,
  revision: Schema.String,
  answer: Schema.String,
  problem: Schema.String
});

/** The panel's result: accepted when all four reviewers answered LGTM with A- or better on the revision. problems says why a reviewer does not count. */
export const Outcome = Schema.Struct({
  accepted: Schema.Boolean,
  revision: Schema.String,
  grades: Schema.Record(Schema.String, Schema.String),
  problems: Schema.Record(Schema.String, Schema.String),
  record: Schema.String
});

const Snapshotted = Schema.Struct({ ok: Schema.Boolean, summary: Schema.String });

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

/** A reviewer that could not answer: its command is not configured, could not start, or failed. */
export class ReviewerFailed extends Schema.TaggedError<ReviewerFailed>()("ReviewerFailed", { reviewer: Schema.String, message: Schema.String }) {}

// run: the run directory. repo: a jj repository holding the revision. revision:
// the one commit to grade. record: a directory that receives the panel's record
// file, or "" to keep the result in the run directory only.
const FlowPayload = { run: Schema.String, repo: Schema.String, revision: Schema.String, record: Schema.String };
const PanelInput = Schema.Struct({ run: Schema.String, record: Schema.String });

export const Snapshot = Action.make("spec-review/Snapshot", { implementationVersion, payload: FlowPayload, success: Snapshotted, error: StepFailed });
export const Review = Action.make("spec-review/Review", {
  implementationVersion,
  payload: { input: PanelInput, role: Schema.String },
  success: Opinion,
  error: StepFailed
});
export const Record = Action.make("spec-review/Record", {
  implementationVersion,
  payload: { input: PanelInput, opinions: Schema.Record(Schema.String, Opinion) },
  success: Outcome,
  error: StepFailed
});

/** The seam to the models: one reviewer reads the prompt in the exported specification's directory and answers in text. */
export class Reviewers extends Context.Service<Reviewers, {
  readonly ask: (reviewer: string, prompt: string, cwd: string) => Effect.Effect<string, ReviewerFailed>;
}>()("spec-review/Reviewers") {}

/**
 * Each reviewer is the command SPEC_REVIEW_AGENT_<NAME> names, such as a
 * coding agent's non-interactive mode: it reads the prompt on standard input
 * in the exported specification's directory and prints its answer.
 */
export const commandReviewers = Layer.succeed(Reviewers, {
  ask: (reviewer, prompt, cwd) =>
    Effect.gen(function* () {
      const variable = `SPEC_REVIEW_AGENT_${reviewer.toUpperCase()}`;
      const command = yield* Effect.orDie(Config.option(Config.NonEmptyString(variable)));
      if (Option.isNone(command)) return yield* new ReviewerFailed({ reviewer, message: `${variable} is not set` });
      return yield* Effect.tryPromise({
        try: (signal) => ask(command.value, prompt, cwd, signal) as Promise<string>,
        catch: (error) => new ReviewerFailed({ reviewer, message: error instanceof Error ? error.message : String(error) })
      });
    })
});

const attempt = <A>(step: string, run: () => A) =>
  Effect.try({ try: run, catch: (error) => new StepFailed({ step, message: error instanceof Error ? error.message : String(error) }) });

type OpinionValue = Schema.Schema.Type<typeof Opinion>;
type Prepared = { readonly opinion?: OpinionValue; readonly prompt: string; readonly cwd: string };

const review = (run: string, reviewer: string) =>
  Effect.gen(function* () {
    const prepared = yield* attempt("review", () => prepare(run, reviewer) as Prepared);
    if (prepared.opinion !== undefined) return prepared.opinion;
    const reviewers = yield* Reviewers;
    const result = yield* Effect.match(reviewers.ask(reviewer, prepared.prompt, prepared.cwd), {
      onFailure: (failure) => ({ failure: failure.message }),
      onSuccess: (answer) => ({ answer })
    });
    return yield* attempt("review", () => settle(run, reviewer, result) as OpinionValue);
  });

/** The steps' implementations, which the flow's host composes with a Reviewers layer. */
export const actions = Layer.mergeAll(
  Snapshot.toLayer(
    ({ run, repo, revision }) => attempt("snapshot", () => snapshot(run, repo, revision)).pipe(Effect.map(({ ok, summary }) => ({ ok, summary }))),
    { implementationVersion }
  ),
  Review.toLayer(({ input, role }) => review(input.run, role), { implementationVersion }),
  Record.toLayer(
    ({ input, opinions }) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        attempt("record", () => record(input.run, opinions, input.record, now) as Schema.Schema.Type<typeof Outcome>)),
    { implementationVersion }
  )
);

export const layer = actions.pipe(Layer.provide(commandReviewers));

const names = Object.keys(REVIEWERS);

/** The gate itself: the four reviewers answer independently, then Record tallies what they said. */
export const panel = Panel.make({
  name: "spec-review-panel",
  description: "Four reviewers grade one revision of the specification independently; the moderator records each verdict and grade",
  panelists: Object.fromEntries(names.map((name) => [name, Review])),
  roles: Object.fromEntries(names.map((name) => [name, name])),
  moderator: Record
});

export default Flow.make("spec-review", {
  description: "Run the specification's acceptance gate on one revision: four reviewers each answer with a verdict and a grade, and the panel's record says whether all four answered LGTM with A- or better",
  capabilities: [],
  // The steps write the run directory and the record directory the payload
  // names, so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize" },
  payload: FlowPayload,
  success: Outcome,
  error: StepFailed,
  body: Node.capture({ implementationVersion }, (input: Schema.Struct.Type<typeof FlowPayload>) =>
    Snapshot.call(input).pipe(Node.andThen(panel.call({ input: { run: input.run, record: input.record } }))))
});
