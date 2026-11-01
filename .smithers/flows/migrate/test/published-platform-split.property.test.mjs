import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { splitBatchPlatform } from "../lib/platform.mjs"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-published-platform-split.json", import.meta.url), "utf8"))
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

function check(input) {
  assert.ok(readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(quote))
  const root = mkdtempSync(join(tmpdir(), "migrate-published-platform-"))
  try {
    const pkg = join(root, "pkg"), path = [...Array.from({ length: input.depth }, (_, i) => "d" + i), input.name].join("/")
    const source = "src/" + path + ".ts", declaration = path + ".d.ts", sibling = path + ".platform.d.ts"
    const exports = input.kind === "explicit" ? { "./main": { types: "./lib/" + declaration } }
      : input.kind === "wildcard" ? { "./*": "./lib/*.js" }
      : { "./*": { types: "./lib/*.d.ts", default: "./src/*.ts" } }
    const files = {
      "package.json": JSON.stringify({ name: "@demo/platform", type: "module", files: ["lib", "src"], exports }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "lib", allowImportingTsExtensions: true, skipLibCheck: true, types: [] }, include: ["src", "ambient.d.ts"] }),
      "ambient.d.ts": 'declare module "node:crypto" { export function createHash(algorithm: string): { update(value: string): { digest(encoding: "hex"): string } } }\n',
      [source]: 'import { createHash } from "node:crypto"\nexport const createRouteId = (input: string): string => createHash("sha256").update(input).digest("hex")\n',
    }
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(pkg, name)), { recursive: true })
      writeFileSync(join(pkg, name), text)
    }
    const consumer = join(root, "consumer")
    mkdirSync(join(consumer, "node_modules/@demo"), { recursive: true })
    symlinkSync(pkg, join(consumer, "node_modules/@demo/platform"), "dir")
    const resolve = () => ts.resolveModuleName("@demo/platform/" + path + ".platform", join(consumer, "main.ts"), {
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    }, ts.sys).resolvedModule?.resolvedFileName
    const emit = (name) => {
      rmSync(join(pkg, "lib"), { recursive: true, force: true })
      const config = ts.readConfigFile(join(pkg, "tsconfig.json"), ts.sys.readFile)
      assert.equal(config.error, undefined)
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, pkg)
      assert.deepEqual(parsed.errors, [])
      const snapshot = join(root, name)
      mkdirSync(snapshot)
      const host = ts.createCompilerHost(parsed.options)
      const write = host.writeFile.bind(host)
      host.writeFile = (file, text, ...rest) => {
        mkdirSync(dirname(file), { recursive: true })
        write(file, text, ...rest)
        if (file.endsWith(".d.ts")) {
          const target = join(snapshot, relative(join(pkg, "lib"), file))
          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, text)
        }
      }
      const program = ts.createProgram(parsed.fileNames, parsed.options, host)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
      assert.equal(program.emit().emitSkipped, false)
      recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
      return snapshot
    }
    const before = emit("before")
    assert.equal(resolve(), undefined, "native consumer cannot import the absent platform module")
    const result = splitBatchPlatform(pkg, [source], ts)
    if (result.splits.length === 0) {
      assert.notEqual(input.kind, "explicit", "the private-helper control remains splittable")
      assert.ok(result.refused.length > 0)
      assert.equal(readFileSync(join(pkg, source), "utf8"), files[source])
      assert.equal(existsSync(join(pkg, "src", path + ".platform.ts")), false)
      return
    }
    assert.deepEqual(result.refused, [])
    assert.equal(result.splits.length, 1)
    const after = emit("after"), resolved = resolve()
    assert.equal(readFileSync(join(after, declaration), "utf8"), readFileSync(join(before, declaration), "utf8"), "old public declaration bytes alone do not prove preservation")
    const comparison = compareDeclarations(ts, before, after)
    if (input.kind === "explicit") {
      assert.equal(resolved, undefined, "explicit exports keep the helper private")
      assert.equal(comparison.identical, true)
      assert.deepEqual(comparison.addedPrivate, [sibling])
    } else {
      assert.equal(resolved, undefined, "alchemy-60: splitting must not publish a new module")
      assert.equal(comparison.identical, true)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("alchemy-60: wildcard publication includes a split platform helper, even with identical old declarations", () => {
  for (const input of corpus.inputs) check(input)
})

test("platform publication spans source depths, names and conditional exports with private controls", () => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("ToLambda", "createRouteId", "Value", "Unicodeé"),
    depth: fc.integer({ min: 0, max: 3 }),
    kind: fc.constantFrom("wildcard", "conditional", "explicit"),
  }), check), { seed: 600060, numRuns: 12, endOnFailure: true })
})
