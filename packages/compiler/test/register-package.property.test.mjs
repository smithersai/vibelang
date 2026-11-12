import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const compiler = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const entryWitness = JSON.parse(readFileSync(new URL("./property-regressions/smithers-eslint-entry-types.json", import.meta.url), "utf8"))
const witness = JSON.parse(readFileSync(new URL("./property-regressions/lang-site-register.json", import.meta.url), "utf8"))

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

test("packed public entries support strict imports without inventing exports", { timeout: 240_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-register-package-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const consumer = join(root, "consumer")
  mkdirSync(consumer)
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}')
  const [packed] = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", root], compiler))
  run(npm, ["install", "--ignore-scripts", "--omit=optional", "--legacy-peer-deps", "--no-audit", "--no-fund", join(root, packed.filename), "typescript@" + ts.version], consumer)
  const manifest = JSON.parse(readFileSync(join(consumer, "node_modules/vibelang/package.json"), "utf8"))
  const targets = value => typeof value === "string" ? [value] : Object.values(value).flatMap(targets)
  const entries = Object.entries(manifest.exports).filter(([, value]) => targets(value).some(path => /\.(?:mjs|cjs|js)$/.test(path)))
  const imports = entries.map(([key], index) => 'import * as entry' + index + ' from "vibelang' + key.slice(1) + '"; void entry' + index).join("\n")
  const allEntries = join(consumer, "entries.mts")
  const api = readFileSync(new URL("./fixtures/public-entry-types.mts", import.meta.url), "utf8")
  writeFileSync(allEntries, imports + "\n" + entryWitness.source + "\n" + api)
  const optionsFor = resolution => ({
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: resolution === "Bundler" ? ts.ModuleKind.ESNext : ts.ModuleKind.Node16,
    moduleResolution: ts.ModuleResolutionKind[resolution]
  })
  const declarationFor = (specifier, options) => {
    const resolved = ts.resolveModuleName(specifier, allEntries, options, ts.sys).resolvedModule
    assert.ok(resolved && /\.d\.(?:mts|cts|ts)$/.test(resolved.resolvedFileName), specifier + " needs a packed declaration")
    return resolved.resolvedFileName
  }
  for (const resolution of ["Bundler", "Node16"]) {
    await t.test("every packed JavaScript export typechecks with " + resolution, () => {
      const options = optionsFor(resolution)
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([allEntries], options))
      assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => consumer, getCanonicalFileName: file => file, getNewLine: () => "\n"
      }))
      // Resolve through the installed export map, rather than trusting source files.
      for (const [key] of entries) {
        const specifier = "vibelang" + key.slice(1)
        declarationFor(specifier, options)
      }
    })
  }
  await t.test("the export guard detects a missing packed declaration for every entry", () => {
    for (const [key, value] of entries) {
      assert.equal(Object.keys(value)[0], "types", key + " must put its types condition first")
      assert.ok(packed.files.some(file => file.path === value.types.slice(2)), key + " declaration must be in the tarball")
      const specifier = "vibelang" + key.slice(1)
      const declaration = declarationFor(specifier, optionsFor("Bundler"))
      const hidden = declaration + ".missing"
      renameSync(declaration, hidden)
      try {
        for (const resolution of ["Bundler", "Node16"]) {
          assert.throws(() => declarationFor(specifier, optionsFor(resolution)), /needs a packed declaration/)
        }
      } finally { renameSync(hidden, declaration) }
    }
  })
  await t.test("strict packed imports vary across entries, syntax and resolution", () => {
    const file = join(consumer, "generated.mts")
    fc.assert(fc.property(fc.record({
      key: fc.constantFrom(...entries.map(([key]) => key)),
      syntax: fc.constantFrom("namespace", "dynamic", "type"),
      resolution: fc.constantFrom("Bundler", "Node16"),
      alias: fc.nat({ max: 10000 })
    }), input => {
      const specifier = JSON.stringify("vibelang" + input.key.slice(1))
      const name = "entry" + input.alias
      const source = input.syntax === "namespace" ? "import * as " + name + " from " + specifier + "; void " + name
        : input.syntax === "dynamic" ? "const " + name + " = await import(" + specifier + "); void " + name
        : "type " + name + " = typeof import(" + specifier + ")"
      writeFileSync(file, source)
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], optionsFor(input.resolution)))
      assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], JSON.stringify(input))
    }), { seed: 7016, numRuns: 18 })
  })
  await t.test("CommonJS consumers resolve the CommonJS declarations", () => {
    const file = join(consumer, "config.cts")
    writeFileSync(file, 'import metro = require("vibelang/metro"); import babel = require("vibelang/babel"); const name: string = babel().plugins[0]().name; const key: string = metro.getCacheKey(); void [name, key]')
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], optionsFor("Node16")))
    assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  })
  await t.test("every packed JavaScript export keeps its Node and Bun runtime entry", () => {
    for (const [key, value] of entries) {
      const specifier = "vibelang" + key.slice(1)
      const target = targets(value).find(path => /\.(?:mjs|cjs|js)$/.test(path))
      const source = 'const specifier = ' + JSON.stringify(specifier) + '; console.log(import.meta.resolve(specifier)); const entry = await import(specifier); console.log(JSON.stringify(Object.keys(entry).sort()))'
      const loaded = (runtime, args) => {
        const [resolved, exported] = run(runtime, args, consumer).trim().split("\n")
        assert.ok(resolved.endsWith(target.slice(1)), specifier)
        return JSON.parse(exported)
      }
      let runtimeExports
      if (key === "./bun") {
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: consumer, encoding: "utf8" })
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /vibelang\/bun is a Bun preload/)
        assert.ok(result.stdout.trim().endsWith(target.slice(1)), specifier)
      } else {
        runtimeExports = loaded(process.execPath, ["--input-type=module", "-e", source])
      }
      if (key === "./register") {
        // This Node preload uses registerHooks, which Bun does not implement.
        const result = spawnSync("bun", ["--eval", source], { cwd: consumer, encoding: "utf8" })
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /registerHooks/)
        assert.ok(result.stdout.trim().endsWith(target.slice(1)), specifier)
      } else {
        runtimeExports = loaded("bun", ["--eval", source])
      }
      if (target.endsWith(".cjs")) run(process.execPath, ["-e", "require(" + JSON.stringify(specifier) + ")"], consumer)
      else {
        const program = ts.createProgram([allEntries], optionsFor("Bundler"))
        const checker = program.getTypeChecker()
        const declaration = program.getSourceFile(declarationFor(specifier, optionsFor("Bundler")))
        const symbol = checker.getSymbolAtLocation(declaration)
        const declared = checker.getExportsOfModule(symbol).filter(symbol =>
          (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).flags & ts.SymbolFlags.Value
        ).map(symbol => symbol.name).sort()
        assert.deepEqual(declared, runtimeExports, specifier + " declarations must match its runtime value exports")
      }
    }
  })
  await t.test("the parser and formatter fit their hosts without package type dependencies", () => {
    const eslintTools = JSON.parse(readFileSync(new URL("./eslint/package.json", import.meta.url), "utf8")).devDependencies
    const compilerTools = JSON.parse(readFileSync(join(compiler, "package.json"), "utf8")).devDependencies
    const runtimeTools = JSON.parse(readFileSync(new URL("../../runtime/package.json", import.meta.url), "utf8")).devDependencies
    run(npm, ["install", "--ignore-scripts", "--omit=optional", "--legacy-peer-deps", "--no-audit", "--no-fund",
      "eslint@" + eslintTools.eslint, "typescript-eslint@" + eslintTools["typescript-eslint"],
      "prettier@" + compilerTools.prettier, "typescript@" + runtimeTools.typescript], consumer)
    const file = join(consumer, "hosts.mts")
    writeFileSync(file, [
      'import type { Linter } from "eslint"',
      'import type { Plugin } from "prettier"',
      'import tseslint from "typescript-eslint"',
      'import parser, { typedProgram } from "vibelang/eslint"',
      'import * as prettier from "vibelang/prettier"',
      'const config: Linter.Config = { languageOptions: { parser } }',
      'const plugin: Plugin = prettier',
      'const configs = tseslint.config({ languageOptions: { parser, parserOptions: { programs: [typedProgram()] } } })',
      'void [config, plugin, configs]'
    ].join("\n"))
    for (const resolution of ["Bundler", "Node16"]) {
      const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], optionsFor(resolution)))
      assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
        getCurrentDirectory: () => consumer, getCanonicalFileName: file => file, getNewLine: () => "\n"
      }))
    }
  })
  const file = join(consumer, "config.mts")
  const check = ({ source, resolution }) => {
    writeFileSync(file, source + '\ntype Registered = typeof import("vibelang/register")\nconst empty: keyof Registered extends never ? true : false = true\n')
    const options = {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
      module: resolution === "Bundler" ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind[resolution]
    }
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options))
    assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], resolution + ": " + source)
  }
  check(witness.input)
  await fc.assert(fc.asyncProperty(
    fc.record({
      source: fc.constantFrom('await import("vibelang/register")', 'import "vibelang/register"', 'import * as registration from "vibelang/register"; void registration'),
      resolution: fc.constantFrom("Bundler", "NodeNext")
    }),
    async input => check(input)
  ), { numRuns: 12 })
  assert.equal(run(process.execPath, ["--input-type=module", "-e", 'const module = await import("vibelang/register"); console.log(JSON.stringify(Object.keys(module)))'], consumer).trim(), "[]")
})
