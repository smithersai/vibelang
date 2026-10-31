// Command-line composition root: runs the ci-health flow on the in-memory
// engine. The run directory holds every step's result.
//
//   bun .smithers/flows/ci-health/run.ts --run <dir> --results <dir> [--since <ISO time>]
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as Crypto from "effect/Crypto";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import { syncCrypto } from "@smthrs/crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import health, { layer } from "./flow.ts";

export const runtime = Interpreter.layerWithImplementations(health, layer).pipe(
  Layer.provideMerge(FlowEngine.layerMemory),
  Layer.provideMerge(Layer.succeed(Crypto.Crypto, syncCrypto))
);

/** execute runs the flow once and returns its exit. */
export const execute = (payload: { run: string; results: string; since: string }) =>
  Effect.runPromiseExit(health.execute(payload, { executionId: `ci-health-${Date.now()}` }).pipe(Effect.provide(runtime)));

if (import.meta.main) {
  const { values } = parseArgs({ options: { run: { type: "string" }, results: { type: "string" }, since: { type: "string" } } });
  if (!values.run || !values.results) {
    console.error("usage: bun .smithers/flows/ci-health/run.ts --run <dir> --results <dir> [--since <ISO time>]");
    process.exit(2);
  }
  const exit = await execute({ run: resolve(values.run), results: resolve(values.results), since: values.since ?? "" });
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `ci-health: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
