// Command-line composition root: runs the ts-bump flow on the in-memory
// engine. The run directory holds every step's result, so the next execution
// resumes from it.
//
//   bun .smithers/flows/ts-bump/run.ts --run <dir> --repo <checkout> --to <commit | next | x.y.z> [--targets "//a //b"]
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as Crypto from "effect/Crypto";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import { syncCrypto } from "@smthrs/crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import bump, { layer } from "./flow.ts";

export const runtime = Interpreter.layerWithImplementations(bump, layer).pipe(
  Layer.provideMerge(FlowEngine.layerMemory),
  Layer.provideMerge(Layer.succeed(Crypto.Crypto, syncCrypto))
);

/** execute runs the flow once and returns its exit. */
export const execute = (payload: { run: string; repo: string; to: string; targets: string }) =>
  Effect.runPromiseExit(bump.execute(payload, { executionId: `ts-bump-${Date.now()}` }).pipe(Effect.provide(runtime)));

if (import.meta.main) {
  const { values } = parseArgs({ options: { run: { type: "string" }, repo: { type: "string" }, to: { type: "string" }, targets: { type: "string" } } });
  if (!values.run || !values.repo || !values.to) {
    console.error('usage: bun .smithers/flows/ts-bump/run.ts --run <dir> --repo <checkout> --to <commit | next | x.y.z> [--targets "//a //b"]');
    process.exit(2);
  }
  const exit = await execute({ run: resolve(values.run), repo: resolve(values.repo), to: values.to, targets: values.targets ?? "" });
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `ts-bump: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
