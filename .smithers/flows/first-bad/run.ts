// Command-line composition root: runs the first-bad flow on the in-memory
// engine. The run directory holds every step's result, each run's results and
// log under runs/, and report.md.
//
//   bun .smithers/flows/first-bad/run.ts --run <dir> --repo <jj repo> --good <rev> --bad <rev> \
//     [--tries 3] [--jobs 8] [--tests '<target>=<Test>,<Test>']... [--keep] <target>...
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as Crypto from "effect/Crypto";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import { syncCrypto } from "@smthrs/crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import firstBad, { layer } from "./flow.ts";
import { finish } from "./lib/steps.mjs";

export const runtime = Interpreter.layerWithImplementations(firstBad, layer).pipe(
  Layer.provideMerge(FlowEngine.layerMemory),
  Layer.provideMerge(Layer.succeed(Crypto.Crypto, syncCrypto))
);

export type Payload = { run: string; repo: string; good: string; bad: string; targets: string; tries: number; jobs: number; tests: string };

/** execute runs the flow once and returns its exit; the workspace is removed unless keep. */
export const execute = async (payload: Payload, keep = false) => {
  try {
    return await Effect.runPromiseExit(firstBad.execute(payload, { executionId: `first-bad-${Date.now()}` }).pipe(Effect.provide(runtime)));
  } finally {
    if (!keep) finish(payload.run);
  }
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      run: { type: "string" }, repo: { type: "string" }, good: { type: "string" }, bad: { type: "string" },
      tries: { type: "string" }, jobs: { type: "string" }, tests: { type: "string", multiple: true }, keep: { type: "boolean" }
    }
  });
  if (!values.run || !values.repo || !values.good || !values.bad || positionals.length === 0) {
    console.error("usage: bun .smithers/flows/first-bad/run.ts --run <dir> --repo <jj repo> --good <rev> --bad <rev> [--tries 3] [--jobs 8] [--tests '<target>=<Test>,<Test>']... [--keep] <target>...");
    process.exit(2);
  }
  const exit = await execute({
    run: resolve(values.run), repo: resolve(values.repo), good: values.good, bad: values.bad,
    targets: positionals.join(" "), tries: Number(values.tries ?? 3), jobs: Number(values.jobs ?? 8),
    tests: (values.tests ?? []).join(" ")
  }, values.keep);
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `first-bad: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
