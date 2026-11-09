import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

export function checkRelocatedEffect({ location, subpaths, newline, value, nestedScope = false }, { native, modules, runtime }) {
  const stock = join(modules, "typescript/bin/tsc")
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-package-identity-")))
  try {
    const target = join(project, location)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(realpathSync(join(modules, "effect")), target, { recursive: true })
    if (nestedScope) writeFileSync(join(target, "dist/package.json"), '{"type":"module"}')
    mkdirSync(join(project, "node_modules"), { recursive: true })
    symlinkSync(target, join(project, "node_modules/effect"))
    const runtimeCopy = join(project, "node_modules/vibelang-runtime")
    mkdirSync(join(runtimeCopy, "node_modules"), { recursive: true })
    cpSync(join(runtime, "package.json"), join(runtimeCopy, "package.json"))
    cpSync(join(runtime, "dist"), join(runtimeCopy, "dist"), { recursive: true })
    symlinkSync(target, join(runtimeCopy, "node_modules/effect"))
    mkdirSync(join(project, "foreign"))
    writeFileSync(join(project, "package.json"), '{"type":"module"}')
    const imports = subpaths
      ? 'import * as Context from "effect/Context"\nimport * as Effect from "effect/Effect"\n'
      : 'import { Context, Effect } from "effect"\n'
    writeFileSync(join(project, "foreign/values.ts"), (imports
      + 'export const Counter = Context.Reference<number>("Counter", { defaultValue: () => 0 })\n'
      + "export const task = Effect.succeed(" + value + ")\n").replaceAll("\n", newline))
    const imported = 'import { Counter, task } from "./foreign/values.js"\n'
    writeFileSync(join(project, "main.vibe"), (imported
      + "export effect function run() { const counter = try Counter; return (try task) + counter }\n"
      + "export effect function typed(): number!! { return try task }\n"
      + "export effect function forked(): number!! { const fiber = fork task; return join fiber }\n"
      + "export effect function* produced() { yield try task }\n"
      + "export service Local { static readonly key = \"identity/Local\"; readonly value: number }\n"
      + "export effect function keyed(): number!!Local { return (try Local).value }\n"
      + "export effect function resource(): number!! { return try scoped(acquireRelease(task, () => Effect.void)) }\n").replaceAll("\n", newline))
    writeFileSync(join(project, "twin.ts"), (imports + imported
      + "export const run = () => Effect.gen(function* () { const counter = yield* Counter; return (yield* task) + counter })\n").replaceAll("\n", newline))
    const options = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }
    for (const [name, entry] of [["tsconfig.json", "main.vibe"], ["tsconfig.twin.json", "twin.ts"]]) {
      writeFileSync(join(project, name), JSON.stringify({ compilerOptions: options, files: [entry] }))
    }
    const run = (command, args) => {
      const child = spawnSync(command, args, { cwd: project, encoding: "utf8", timeout: 30000 })
      assert.ifError(child.error)
      return child
    }
    const twin = run(process.execPath, [stock, "--pretty", "false", "-p", "tsconfig.twin.json"])
    assert.equal(twin.status, 0, "TypeScript twin:\n" + twin.stdout + twin.stderr)
    const actual = run(native, ["--pretty", "false", "-p", "tsconfig.json"])
    assert.equal(actual.status, 0, "native relocated package:\n" + actual.stdout + actual.stderr)
    for (const [compiler, args, config, entry] of [
      [process.execPath, [stock], "tsconfig.twin.json", "twin.js"],
      [native, [], "tsconfig.json", "main.js"]
    ]) {
      const emitted = run(compiler, [...args, "--pretty", "false", "-p", config, "--noEmit", "false", "--outDir", "out"])
      assert.equal(emitted.status, 0, "emit " + entry + ":\n" + emitted.stdout + emitted.stderr)
      const executed = run(process.execPath, ["--input-type=module", "-e",
        'import { Effect } from "effect"; import { run } from "./out/' + entry + '"; console.log(await Effect.runPromise(run()))'])
      assert.equal(executed.status, 0, "run " + entry + ":\n" + executed.stdout + executed.stderr)
      assert.equal(executed.stdout.trim(), String(value), "resolved runtime result " + entry)
    }
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
}

