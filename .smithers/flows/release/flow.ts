import { Action, Flow, HumanTask } from "@smthrs/flow";
import { Node, type Planned } from "@smthrs/plan";
import { Effect, Layer, Schema } from "effect";
import { fileURLToPath } from "node:url";
import * as steps from "./lib/steps.mjs";

// One execution is one VibeLang release: check the checkout, build the six
// platform binaries and every package, rehearse the install from a throwaway
// registry, ask a maintainer to approve the exact tarballs, ask for npm's
// one-time password, publish, and verify the published packages. The run's
// journal is the release record: each step's result, the approval and when
// each happened. README.md describes the run.

const implementationVersion = "release/v1";

// rounds is how many one-time passwords one run asks for before it stops.
const rounds = 3;

export class StepFailed extends Schema.TaggedError<StepFailed>()("StepFailed", { step: Schema.String, message: Schema.String }) {}

const Options = {
  // The checkout to release; "" is the checkout this flow is in.
  repo: Schema.String,
  version: Schema.String,
  registry: Schema.String,
  // VIBELANG_SKIP: comma-separated name patterns of packages to leave out.
  skip: Schema.String
};

const Input = {
  version: Schema.String,
  repo: Schema.optional(Schema.String),
  registry: Schema.optional(Schema.String),
  skip: Schema.optional(Schema.String)
};

const Package = Schema.Struct({ name: Schema.String, version: Schema.String, file: Schema.String, shasum: Schema.String });

const Checked = Schema.Struct({
  version: Schema.String,
  registry: Schema.String,
  publisher: Schema.String,
  lastPublished: Schema.String,
  toolchain: Schema.Record(Schema.String, Schema.String),
  notes: Schema.String
});
const Built = Schema.Struct({ version: Schema.String, binaries: Schema.String, packages: Schema.String });
const Candidate = Schema.Struct({ packages: Schema.Array(Package), approval: Schema.String, rehearsal: Schema.String, dryRun: Schema.String });
const Published = Schema.Struct({ published: Schema.Boolean, output: Schema.String });
const Verified = Schema.Struct({ output: Schema.String });

const Result = Schema.Struct({
  status: Schema.Literals(["published", "declined"]),
  version: Schema.String,
  registry: Schema.String
});

export const Check = Action.make("release/Check", { implementationVersion, payload: Options, success: Checked, error: StepFailed });
export const Build = Action.make("release/Build", { implementationVersion, payload: Options, success: Built, error: StepFailed });
export const Rehearse = Action.make("release/Rehearse", { implementationVersion, payload: Options, success: Candidate, error: StepFailed });
export const Publish = Action.make("release/Publish", {
  implementationVersion,
  payload: { ...Options, packages: Schema.Array(Package), last: Schema.Boolean },
  success: Published,
  error: StepFailed,
  tier: "irreversible"
});
export const Deploy = Action.make("release/Deploy", { implementationVersion, payload: Options, success: Verified, error: StepFailed, tier: "irreversible" });
export const Verify = Action.make("release/Verify", { implementationVersion, payload: Options, success: Verified, error: StepFailed });

const here = fileURLToPath(new URL("../../../", import.meta.url));

const step = <A>(name: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (error) => new StepFailed({ step: name, message: error instanceof Error ? error.message : String(error) }) });

/** The steps' implementations and the questions' handler, which the flow's host composes. */
export const layer = Layer.mergeAll(
  HumanTask.layer,
  Check.toLayer((o) => step("check", () => steps.check(o.repo || here, o)), { implementationVersion }),
  Build.toLayer((o) => step("build", () => steps.build(o.repo || here, o)), { implementationVersion }),
  Rehearse.toLayer((o) => step("rehearse", async () => {
    const candidate = await steps.rehearse(o.repo || here, o);
    return { ...candidate, approval: steps.approval(o, candidate.packages) };
  }), { implementationVersion }),
  Publish.toLayer((o) => step("publish", () => steps.publish(o.repo || here, o)), { implementationVersion }),
  Deploy.toLayer((o) => step("deploy", async () => ({ output: steps.tail(await steps.must(o.repo || here, "deploy", "sh", ["scripts/release/deploy-site.sh", o.version])) })), { implementationVersion }),
  Verify.toLayer((o) => step("verify", () => steps.verify(o.repo || here, o)), { implementationVersion })
);

type Options = Schema.Struct.Type<typeof Options>;
type Candidate = Schema.Schema.Type<typeof Candidate>;

const published = (options: Options) =>
  (new URL(options.registry).href === steps.NPM ? Deploy.call(options).pipe(Node.andThen(Verify.call(options))) : Verify.call(options)).pipe(
    Node.map(Node.capture({ implementationVersion, options }, () => ({ status: "published" as const, version: options.version, registry: options.registry })))
  );

// round asks for one one-time password and publishes with it. npm refusing
// the password sends the run to the next round; the last round's refusal
// fails the run, and a new run resumes the publication where it stopped.
const round = (options: Options, candidate: Planned.Planned<Candidate>, n: number): Node.Node<Schema.Schema.Type<typeof Result>, StepFailed | HumanTask.HumanTaskFailed, any> =>
  Node.branch(
    HumanTask.action.call({ name: `otp-${n}`, kind: "confirm", prompt: steps.otpPrompt(options.registry, n, rounds), maxAttempts: 3 }),
    {
      if: Node.capture({ implementationVersion }, (answer: unknown) => answer === true),
      else: Node.capture({ implementationVersion }, () => Node.succeed({ status: "declined" as const, version: options.version, registry: options.registry })),
      then: Node.capture({ implementationVersion, n }, () =>
      Node.branch(Publish.call({ ...options, packages: candidate.packages, last: n === rounds }), {
        if: Node.capture({ implementationVersion }, (result: Schema.Schema.Type<typeof Published>) => result.published),
        then: Node.capture({ implementationVersion, options }, () => published(options)),
        else: Node.capture({ implementationVersion, n }, () =>
          n < rounds ? round(options, candidate, n + 1) : Node.fail(new StepFailed({ step: "publish", message: "npm refused every one-time password" })))
      }))
    }
  );

export default Flow.make("release", {
  description: "Release VibeLang to npm: check the checkout, build the platform binaries and packages, rehearse the install from a throwaway registry, ask a maintainer to approve the exact tarballs and for npm's one-time password, publish, and verify the published packages",
  capabilities: ["fs:read:**", "fs:write:**", "proc:spawn:*", "net:get:*", "net:post:*"],
  // The steps read and write the checkout the payload names and the registry,
  // so the flow declares no paths here.
  effects: { reads: [], writes: [], mode: "expected", onConflict: "serialize", tier: "irreversible" },
  payload: Input,
  success: Result,
  error: Schema.Union([StepFailed, HumanTask.HumanTaskFailed]),
  body: Node.capture({ implementationVersion, rounds }, (input: Schema.Struct.Type<typeof Input>) => {
    const options: Options = { repo: input.repo ?? "", version: input.version, registry: input.registry ?? steps.NPM, skip: input.skip ?? "" };
    return Node.bindPlanned(
      Check.call(options).pipe(Node.andThen(Build.call(options)), Node.andThen(Rehearse.call(options))),
      Node.capture({ implementationVersion }, (candidate: Planned.Planned<Candidate>) =>
        Node.branch(HumanTask.action.call({ name: "publish", kind: "confirm", prompt: candidate.approval, maxAttempts: 3 }), {
          if: Node.capture({ implementationVersion }, (answer: unknown) => answer === true),
          then: Node.capture({ implementationVersion }, () => round(options, candidate, 1)),
          else: Node.capture({ implementationVersion }, () =>
            Node.succeed({ status: "declined" as const, version: options.version, registry: options.registry }))
        }))
    );
  })
});
