// Command line for the spec-review flow: runs one panel execution on a
// revision via the shared durable host (`../host.ts`), recording the run in
// `<root>/.flows/` so `smthrs runs list` tracks it. Pass `--memory` for an
// isolated in-memory run. The run directory holds the exported specification,
// each reviewer's prompt, answer and opinion, and the panel's result, so a
// second execution with the same run directory resumes it.
//
//   SPEC_REVIEW_AGENT_ASTRA="<command>" SPEC_REVIEW_AGENT_SOL="<command>" \
//   SPEC_REVIEW_AGENT_FABLE="<command>" SPEC_REVIEW_AGENT_OPUS="<command>" \
//     bun .smithers/flows/spec-review/run.ts --run <dir> --revision <rev> [--repo <jj repo>] [--record <dir>] [--memory] [--root <dir>] [--db <file>]
//
// It exits 0 when the panel passed, 1 when it did not, and 2 when a step failed.
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { executeEffect, parseHostFlags, type HostOptions } from "../host.ts";
import specReview, { commandReviewers, actions, Outcome, Reviewers } from "./flow.ts";

export type Payload = { run: string; repo: string; revision: string; record: string };

/** execute runs the flow once with the given reviewers and returns the panel's outcome, or the failure. */
export const execute = (
  payload: Payload,
  reviewers: Layer.Layer<Reviewers> = commandReviewers,
  options: HostOptions = {},
) =>
  Effect.runPromiseExit(
    executeEffect(
      specReview,
      actions.pipe(Layer.provide(reviewers)),
      payload,
      { root: payload.repo, ...options },
    ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Outcome))),
  );

if (import.meta.main) {
  const { options: hostOptions, rest } = parseHostFlags(process.argv.slice(2));
  const { values } = parseArgs({
    args: rest,
    options: {
      run: { type: "string" },
      repo: { type: "string" },
      revision: { type: "string" },
      record: { type: "string" },
    },
  });
  if (!values.run || !values.revision) {
    console.error("usage: bun .smithers/flows/spec-review/run.ts --run <dir> --revision <rev> [--repo <jj repo>] [--record <dir>] [--memory] [--root <dir>] [--db <file>]");
    process.exit(2);
  }
  const exit = await execute(
    {
      run: resolve(values.run),
      repo: resolve(values.repo ?? "."),
      revision: values.revision,
      record: values.record ? resolve(values.record) : "",
    },
    commandReviewers,
    hostOptions,
  );
  if (Exit.isSuccess(exit)) {
    console.log(JSON.stringify(exit.value, null, 2));
    process.exitCode = exit.value.accepted ? 0 : 1;
  } else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `spec-review: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 2;
  }
}
