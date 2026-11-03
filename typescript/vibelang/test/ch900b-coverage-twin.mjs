// Chapter 900 coverage references: stock TypeScript checks the independent Effect
// program and compares its inferred A/E/R channels and complete Exit to VibeLang.
// COVERAGE_TWIN_EFFECT selects an isolated Effect 4.1.0 proof; normal cases use the runtime pin.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
const require = createRequire(new URL("../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")

export async function compareTwin(directory, expected, expectedTag = "Success") {
  assert.equal(ts.version, "5.9.3")
  const reference = join(directory, "effect-ts")
  const modules = join(reference, "node_modules")
  mkdirSync(modules, { recursive: true })
  const effect = realpathSync(process.env.COVERAGE_TWIN_EFFECT || join(directory, "node_modules/effect"))
  rmSync(join(modules, "effect"), { force: true, recursive: true })
  symlinkSync(effect, join(modules, "effect"), "dir")
  const compiled = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(reference, "tsconfig.json")], { encoding: "utf8", timeout: 60_000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const declarations = [join(directory, "out/main.d.ts"), join(reference, "out/main.d.ts")]
  const program = ts.createProgram(declarations, { strict: true, skipLibCheck: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [] })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  const checker = program.getTypeChecker()
  const returns = declarations.map(file => {
    const source = program.getSourceFile(file)
    const main = checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find(s => s.name === "main")
    assert.ok(main, file + ": exported main")
    const signatures = checker.getTypeOfSymbolAtLocation(main, main.valueDeclaration).getCallSignatures()
    assert.equal(signatures.length, 1)
    const result = checker.getReturnTypeOfSignature(signatures[0])
    const arguments_ = checker.getTypeArguments(result)
    assert.equal(arguments_.length, 3, file + ": main returns Effect<A, E, R>")
    const shape = type => {
      if (type.isUnion()) return ["union", ...type.types.map(shape).map(JSON.stringify).sort()]
      if (checker.isTupleType(type)) return ["tuple", !!type.target.readonly, type.target.elementFlags, ...checker.getTypeArguments(type).map(shape)]
      if (checker.isArrayType(type)) return ["array", shape(checker.getTypeArguments(type)[0])]
      return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType)
        .replace(/import\("[^"]*"\)\./g, "").replace(/\b(?:Cause|Schema)\./g, "")
    }
    return arguments_.map(shape)
  })
  assert.deepEqual(returns[0], returns[1], "stock TypeScript inferred success, error and requirement types")
  const sourceModules = await Promise.all([import(pathToFileURL(join(directory, "out/main.js"))), import(pathToFileURL(join(reference, "out/main.js")))])
  const effectModules = await Promise.all([import(pathToFileURL(join(directory, "node_modules/effect/dist/Effect.js"))), import(pathToFileURL(join(effect, "dist/Effect.js")))])
  const exits = await Promise.all(sourceModules.map((module, i) => effectModules[i].runPromise(effectModules[i].exit(module.main()))))
  assert.deepEqual(JSON.parse(JSON.stringify(exits[0])), JSON.parse(JSON.stringify(exits[1])), "complete serialized Exit")
  assert.equal(exits[0]._tag, expectedTag)
  if (expectedTag === "Success") assert.deepEqual(exits[0].value, expected)
  else assert.deepEqual(JSON.parse(JSON.stringify(exits[0])), expected)
  console.log("twins agree")
}
