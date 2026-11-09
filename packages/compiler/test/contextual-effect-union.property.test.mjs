import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(root, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(root, "packages/runtime")
const stock = join(modules, "typescript/bin/tsc")
const absent = [native, stock, join(modules, "effect/package.json"), join(runtime, "dist/index.d.ts")].find(path => !existsSync(path))
const skip = absent && "missing contextual typing dependency: " + absent
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-contextual-effect-union.json", import.meta.url)))
function check({ field, union, context, newline, missing = false }) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-contextual-union-")))
  try {
    mkdirSync(join(project, "node_modules"))
    symlinkSync(realpathSync(join(modules, "effect")), join(project, "node_modules/effect"))
    symlinkSync(runtime, join(project, "node_modules/vibelang-runtime"))
    writeFileSync(join(project, "package.json"), '{"name":"contextual-union-fixture","type":"module"}')
    const header = 'import * as Effect from "effect/Effect"\n'
      + 'type Plugin = { api: { registerProducer: (props: {' + field + ': string}) => Effect.Effect<{name: string}> }; start?: (ports: Record<string, number>) => Effect.Effect<void> }\n'
      + 'const consume = (_builder: ' + union + '): Effect.Effect<void> => Effect.void\n'
    const body = 'return { api: {registerProducer: (props) => Effect.succeed({name: props.' + (missing ? "missing" : field) + '})}, start: (ports) => Effect.sync(() => {const port: number = ports.worker; void port}) }'
    const input = context === "argument"
      ? 'consume(effect { ' + body + ' })\n'
      : 'const plugin: ' + union + ' = effect { ' + body + ' }\nconsume(plugin)\n'
    const twin = input.replace("effect {", "Effect.gen(function*() {").replace(" })", " }))").replace(" }\n", " })\n")
    writeFileSync(join(project, "main.vibe"), (header + input).replaceAll("\n", newline))
    writeFileSync(join(project, "twin.ts"), (header + twin).replaceAll("\n", newline))
    const options = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }
    if (missing) options.noImplicitAny = false
    for (const [name, entry] of [["native", "main.vibe"], ["twin", "twin.ts"]]) {
      writeFileSync(join(project, name + ".json"), JSON.stringify({ compilerOptions: options, files: [entry] }))
    }
    const run = (command, args) => {
      const child = spawnSync(command, args, { cwd: project, encoding: "utf8", timeout: 30000 })
      assert.ifError(child.error)
      return { status: child.status, output: child.stdout + child.stderr }
    }
    const reference = run(process.execPath, [stock, "--pretty", "false", "-p", "twin.json"])
    const actual = run(native, ["--pretty", "false", "-p", "native.json"])
    const errors = output => [...output.matchAll(/error (TS\d+|EK\d+):/g)].map(match => match[1]).sort()
    assert.equal(reference.status, missing ? 2 : 0, "TypeScript control:\n" + reference.output)
    assert.deepEqual(errors(reference.output), missing ? ["TS2339"] : [])
    assert.equal(actual.status, reference.status, "native contextual typing:\n" + actual.output)
    assert.deepEqual(errors(actual.output), errors(reference.output), actual.output)
  } finally { rmSync(project, { recursive: true, force: true }) }
}
test("contextual Effect union quotes TypeScript parity", () => {
  assert.ok(readFileSync(SpecPath("000-intro.md"), "utf8").includes(corpus.rule))
})
test("Alchemy effect block returns retain contextual callback parameters", { skip }, () => check(corpus.input))
test("missing callback properties match TypeScript even with implicit any allowed", { skip }, () => check({ ...corpus.input, missing: true }))
test("property: contextual success types survive union order, nesting and layout", { skip }, async () => {
  await checkProperty(fc, {
    name: corpus.property, rule: corpus.rule, command: "node --test packages/compiler/test/contextual-effect-union.property.test.mjs",
    arbitrary: fc.record({
      field: fc.constantFrom("queueName", "topic", "resource"),
      union: fc.constantFrom("Plugin | Effect.Effect<Plugin>", "Effect.Effect<Plugin> | Plugin", "Plugin | Effect.Effect<Plugin> | undefined", "null | Effect.Effect<Plugin> | Plugin"),
      context: fc.constantFrom("argument", "annotation"), newline: fc.constantFrom("\n", "\r\n")
    }), check, numRuns: 24, regressions: new URL("./property-regressions/", import.meta.url)
  })
})
