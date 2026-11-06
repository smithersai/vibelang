import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { rewriteExports } from "../lib/codemod.mjs"
import { emitPackageJs } from "../lib/declarations.mjs"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-emitted-sidecar-layout.json", import.meta.url), "utf8"))
const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
assert.ok(spec.includes(corpus.rule))
const layouts = ["source", "package", "composite", "inferred-local", "inferred-external"]

async function exercise(layout, depth = 0, directory = ".vibe/declarations") {
  const root = mkdtempSync(join(tmpdir(), "emitted-sidecar-layout-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  }
  const source = "src/" + "nested/".repeat(depth) + "tool"
  const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [],
    ...(layout === "source" ? { rootDir: "src" } : layout === "package" ? { rootDir: "." } : {}),
    ...(layout === "composite" ? { composite: true } : {}) }
  try {
    put("package.json", { type: "module" })
    for (const side of ["native", "converted"]) {
      put(side + "/producer/package.json", { name: "layout-producer", type: "module", exports: { "./tool": "./" + source + ".ts" } })
      put(side + "/producer/tsconfig.json", { vibe: { sidecarDir: directory },
        compilerOptions: options, include: ["src"] })
      put(side + "/producer/" + source + (side === "native" ? ".ts" : ".vibe"), corpus.source)
      if (layout === "inferred-external") {
        put(side + "/shared/index.ts", "export const shared = 1\n")
        put(side + "/producer/src/import.ts", 'export { shared } from "../../shared/index.js";\n')
      }
    }
    const native = join(root, "native/producer"), producer = join(root, "converted/producer")
    const baseline = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json",
      "--declaration", "--emitDeclarationOnly", "--outDir", "baseline"], { cwd: native, encoding: "utf8", timeout: 30000 })
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr)
    const renamed = [{ from: "producer/" + source + ".ts", to: "producer/" + source + ".vibe" }]
    rewriteExports(join(root, "converted"), renamed)
    const metadata = JSON.parse(readFileSync(join(producer, "package.json"))).exports["./tool"]
    const sidecar = join(producer, metadata.types)
    const emitted = await emitPackageJs({ compiler, tsconfigs: ["tsconfig.json"], packageDir: producer,
      root: join(root, "converted"), log: join(root, "emit.log") })
    assert.equal(emitted.code, 0, JSON.stringify(emitted.diagnostics))
    assert.ok(existsSync(sidecar), layout + ": export target missing: " + metadata.types)
    const projected = relative(join(producer, directory), sidecar).replace(/\.d\.vibe\.ts$/, ".d.ts")
    const normalize = text => text.replaceAll("./tool.vibe", "./tool.js")
    assert.equal(normalize(readFileSync(sidecar, "utf8")), readFileSync(join(native, "baseline", projected), "utf8"))
    routeEmittedExports(producer, emitted.outputs)
    mkdirSync(join(root, "converted/node_modules"), { recursive: true })
    symlinkSync(producer, join(root, "converted/node_modules/layout-producer"))
    put("converted/consumer.ts", 'import { Tool } from "layout-producer/tool"; const value: Tool.Content = {value: 3}; export { value };\n')
    const check = () => spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "--strict", "--noEmit",
      "--moduleResolution", "bundler", "--module", "esnext", "--target", "es2022", "--skipLibCheck",
      "consumer.ts"], { cwd: join(root, "converted"), encoding: "utf8", timeout: 30000 })
    const valid = check()
    assert.equal(valid.status, 0, valid.stdout)
    put("converted/consumer.ts", 'import { Tool } from "layout-producer/tool"; const value: Tool.Content = {value: "bad"}; export { value };\n')
    const invalid = check()
    assert.equal(invalid.status, 2)
    assert.match(invalid.stdout, /TS2322/)
    const runtime = spawnSync(process.execPath, ["--input-type=module", "-e",
      'const m = await import("layout-producer/tool"); console.log(m.Tool.Content)'],
      { cwd: join(root, "converted"), encoding: "utf8", timeout: 30000 })
    assert.equal(runtime.status, 0, runtime.stderr)
    assert.equal(runtime.stdout.trim(), "1")
    assert.equal(readFileSync(join(producer, source + ".vibe"), "utf8"), corpus.source)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const layout of layouts) test("JavaScript emission preserves the " + layout + " declaration layout",
  { skip: !compiler && "set VIBELANG_BINARY" }, () => exercise(layout))

test("generated source roots retain declaration identity, consumer checking and runtime exports",
  { skip: !compiler && "set VIBELANG_BINARY" }, async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...layouts), fc.integer({ min: 0, max: 2 }),
      fc.constantFrom(".vibe/declarations", ".private/types"),
      async (layout, depth, directory) => exercise(layout, depth, directory)), { numRuns: 16, seed: 1066 })
  })
