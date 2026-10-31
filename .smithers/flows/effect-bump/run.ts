// Command-line composition root: runs the effect-bump flow on the in-memory
// engine. The run directory holds every step's result, so the next execution
// resumes from it.
//
//   bun .smithers/flows/effect-bump/run.ts --run <dir> --repo <checkout> --version <x.y.z>
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
export const execute = (payload: { run: string; repo: string; version: string }) =>
  Effect.runPromiseExit(bump.execute(payload, { executionId: `effect-bump-${Date.now()}` }).pipe(Effect.provide(runtime)));

if (import.meta.main) {
  const { values } = parseArgs({ options: { run: { type: "string" }, repo: { type: "string" }, version: { type: "string" } } });
  if (!values.run || !values.repo || !values.version) {
    console.error("usage: bun .smithers/flows/effect-bump/run.ts --run <dir> --repo <checkout> --version <x.y.z>");
    process.exit(2);
  }
  const exit = await execute({ run: resolve(values.run), repo: resolve(values.repo), version: values.version });
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `effect-bump: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
