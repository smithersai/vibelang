import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { findBinary } from "../binary.mjs"

const repository = fileURLToPath(new URL("../../../", import.meta.url))
// Use the runtime's pinned stock TypeScript as tooling, outside the consumer.
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript")
const tsc = require.resolve("typescript/bin/tsc")
const witness = JSON.parse(readFileSync(new URL("./property-regressions/smithers-projection-body-types.json", import.meta.url), "utf8"))
const npm = process.platform === "win32" ? "npm.cmd" : "npm"

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000, ...options })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, [command, ...args].join(" ") + "\n" + result.stdout + result.stderr)
  return result.stdout
}

test("packed projections resolve their prelude and preserve body-local types with stock TypeScript", { timeout: 240_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-projection-package-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tarballs = join(root, "tarballs")
  const consumer = join(root, "consumer")
  mkdirSync(tarballs)
  mkdirSync(consumer)
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }))
  t.diagnostic("packing compiler and runtime")
  const packed = ["compiler", "runtime"].map(name => {
    const result = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", tarballs], join(repository, "packages", name)))[0]
    return join(tarballs, result.filename)
  })
  t.diagnostic("installing only the tarballs and their required peers in an isolated consumer")
  run(npm, ["install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", ...packed], consumer)
  const installed = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8")).dependencies
  assert.deepEqual(Object.keys(installed).sort(), ["vibelang", "vibelang-runtime"])
  // Native binaries are platform packages; use this checkout's matching build.
  const env = { ...process.env, VIBELANG_BINARY: findBinary() }
  const project = (file, source) => {
    const path = join(consumer, file)
    writeFileSync(path, source)
    const result = JSON.parse(run(process.execPath, [join(consumer, "node_modules/vibelang/bin/vibelang"), "--ts-projection", path], consumer, { input: source, env }))
    assert.deepEqual(result.diagnostics ?? [], [], file)
    const virtual = path.replace(/\.vibex?$/, result.extension)
    writeFileSync(virtual, result.text)
    return virtual
  }
  const files = new Map()
  files.set(project(witness.file, witness.source), witness.locals)
  // A pure export also writes an inline import type for its phantom signature.
  files.set(project("pure.vibe", "export effect function pure() { return 1 }\n"), {})
  const shape = fc.record({
    value: fc.integer({ min: -1000, max: 1000 }),
    kind: fc.constantFrom("number", "string", "boolean"),
    extension: fc.constantFrom(".vibe", ".vibex"),
    prefix: fc.constantFrom("", "// é body\n", "/* body */\n"),
    alias: fc.boolean(),
  })
  let index = 0
  fc.assert(fc.property(shape, sample => {
    const name = "value" + index
    const expression = { number: "id.length", string: "id.toUpperCase()", boolean: "id.length > 0" }[sample.kind]
    const effect = sample.alias ? "E" : "Effect"
    const source = sample.prefix + (sample.alias ? 'import { Effect as E } from "effect"\n' : "") +
      "export effect function load(id: string) {\n  const seed: number = " + sample.value + "\n  const " + name + " = try " + effect + ".succeed(" + expression + ")\n  return { seed, " + name + " }\n}\n"
    files.set(project("sample-" + index++ + sample.extension, source), { [name]: sample.kind, seed: "number" })
  }), { seed: 91109, numRuns: 24 })

  for (const [module, moduleResolution] of [[ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext], [ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler]]) {
    t.diagnostic("checking packed projections with " + ts.ModuleResolutionKind[moduleResolution])
    const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ESNext, module, moduleResolution, jsx: ts.JsxEmit.Preserve }
    const program = ts.createProgram([...files.keys()], options)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    const checker = program.getTypeChecker()
    const witnessFile = program.getSourceFile([...files.keys()][0])
    const observe = node => {
      if (ts.isVariableDeclaration(node) && node.name.getText(witnessFile) === "value")
        t.diagnostic("witness body-local value: " + checker.typeToString(checker.getTypeAtLocation(node.name)))
      ts.forEachChild(node, observe)
    }
    observe(witnessFile)
    assert.deepEqual(diagnostics.map(d => "TS" + d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "stock TypeScript diagnostics")
    for (const [file, locals] of files) {
      const found = new Set()
      const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && Object.hasOwn(locals, node.name.text)) {
          const type = checker.getTypeAtLocation(node.name)
          assert.equal(type.flags & ts.TypeFlags.Any, 0, file + ": " + node.name.text + " became any")
          assert.equal(checker.typeToString(type), locals[node.name.text], file + ": " + node.name.text)
          found.add(node.name.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(program.getSourceFile(file))
      assert.deepEqual([...found].sort(), Object.keys(locals).sort())
    }
  }
  writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", jsx: "preserve" },
    include: ["*.ts", "*.tsx"],
  }))
  run(process.execPath, [tsc, "--project", consumer, "--pretty", "false"], consumer)
})

test("the compiler ships the current projection helper declarations", () => {
  run(process.execPath, ["scripts/generate-projection-prelude.mjs", "--check"], repository)
})
