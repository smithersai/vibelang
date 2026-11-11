// Command line for the migrate flow: runs one execution, which migrates the
// next batch of a run, in this process on the in-memory engine. The run
// directory holds every step's result, so the next execution resumes from it.
// The durable host refuses this flow: its steps load the target repository's
// own tools (TypeScript, knip, oxlint, Vite) through createRequire, which
// smthrs cannot pin before a run.
//
//   MIGRATE_AGENT="<command>" bun .smithers/flows/migrate/run.ts --run <dir> \
//     --target <repo> --package <dir> --test "<command>" [--test-cwd <dir>] --toolchain <dir>
//
// --scope <scope.txt> plans one whole-scope pass instead, which needs no agent.
import { Cause, Exit, Option } from "effect";
import migrate, { layer } from "./flow.ts";
import { execute } from "../in-process.ts";
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

if (import.meta.main) {
  const payload = payloadFrom(process.argv.slice(2));
  const exit = await execute(migrate, layer, payload);
  if (Exit.isSuccess(exit)) console.log(JSON.stringify(exit.value, null, 2));
  else {
    const failure = Cause.findErrorOption(exit.cause);
    console.error(Option.isSome(failure) ? `migrate: ${JSON.stringify(failure.value)}` : Cause.pretty(exit.cause));
    process.exitCode = 1;
  }
}
