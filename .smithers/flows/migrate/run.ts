// Command line for the migrate flow: runs one execution, which migrates the
// next batch of a run, on the shared durable SQLite host (`../host.ts`) so
// `smthrs runs list` tracks each run. Pass `--memory` for an ephemeral run.
// The run directory also holds every step's result, so the next execution
// resumes from it. (`smthrs flow start migrate` still refuses this flow
// directly because its steps load the target repository's own tools through
// `createRequire`, which smthrs cannot pin before a run.)
//
//   MIGRATE_AGENT="<command>" bun .smithers/flows/migrate/run.ts --run <dir> \
//     --target <repo> --package <dir> --test "<command>" [--test-cwd <dir>] --toolchain <dir> [--memory] [--root <dir>] [--db <file>]
//
// --scope <scope.txt> plans one whole-scope pass instead, which needs no agent.
import { Cause, Exit, Option } from "effect";
import migrate, { layer } from "./flow.ts";
import { execute, parseHostFlags } from "../host.ts";
import { many, one, parseArgs } from "./lib/args.mjs";

export function payloadFrom(argv: ReadonlyArray<string>) {
  const { rest } = parseHostFlags(argv);
  const { options } = parseArgs(["flow", ...rest]);
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

if (import.meta.main) {
  const { options: hostOptions, rest } = parseHostFlags(process.argv.slice(2));
  const payload = payloadFrom(rest);
  const exit = await execute(migrate, layer, payload, hostOptions);
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `migrate: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
