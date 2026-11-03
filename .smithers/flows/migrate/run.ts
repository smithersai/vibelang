// Command-line composition root: runs one execution of the migrate flow, which
// migrates the next batch of a run, on the in-memory engine. The run directory
// holds every step's result, so the next execution resumes from it.
//
//   MIGRATE_AGENT="<command>" bun .smithers/flows/migrate/run.ts --run <dir> \
//     --target <repo> --package <dir> --test "<command>" [--test-cwd <dir>] --toolchain <dir>
//
// --scope <scope.txt> plans one whole-scope pass instead, which needs no agent.
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as Crypto from "effect/Crypto";
import { FlowEngine } from "@smthrs/engine";
import { Interpreter } from "@smthrs/flow";
import { syncCrypto } from "@smthrs/crypto";
import migrate, { layer } from "./flow.ts";
import { many, one, parseArgs } from "./lib/args.mjs";

export function payloadFrom(argv: ReadonlyArray<string>) {
  const { options } = parseArgs(["flow", ...argv]);
  return {
    run: one(options, "run"),
    target: one(options, "target"),
    packages: many(options.package) as Array<string>,
    ...(options["emitted-project"] ? { emittedProjects: many(options["emitted-project"]) as Array<string> } : {}),
    ...(options["route-bundled-imports"] ? { routeBundledImports: true } : {}),
    test: one(options, "test"),
    ...(options.main ? { main: one(options, "main") } : {}),
    ...(options["after-convert"] ? { afterConvert: many(options["after-convert"]) as Array<string> } : {}),
    ...(options["measure-command"] ? { measureCommand: one(options, "measure-command") } : {}),
    testCwd: typeof options["test-cwd"] === "string" ? options["test-cwd"] : ".",
    toolchain: one(options, "toolchain"),
    ...(options.scope ? { scope: one(options, "scope") } : {})
  };
}

export const runtime = Interpreter.layerWithImplementations(migrate, layer).pipe(
  Layer.provideMerge(FlowEngine.layerMemory),
  Layer.provideMerge(Layer.succeed(Crypto.Crypto, syncCrypto))
);

if (import.meta.main) {
  const payload = payloadFrom(process.argv.slice(2));
  const exit = await Effect.runPromiseExit(
    migrate.execute(payload, { executionId: `migrate-${Date.now()}` }).pipe(Effect.provide(runtime))
  );
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `migrate: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
