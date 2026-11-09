import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const preload = join(compilerPackage, "bun.mjs")
const native = process.env.VIBELANG_BINARY || join(compilerPackage, "native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const bun = process.env.VIBELANG_TEST_BUN || "bun"
const stock = join(modules, "typescript/bin/tsc")
const missing = [native, stock, join(modules, "effect"), join(runtime, "dist/index.js")].find(path => !existsSync(path))
const skip = missing ? "missing test dependency: " + missing : spawnSync(bun, ["--version"]).status !== 0 && "Bun is unavailable"
const rule = "Anything TypeScript or the pinned TC39 proposal already defines (evaluation order, binding, types, modules, resolution, declaration emit) is as in TypeScript and is not restated."
const regression = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-bun-typescript-sibling.json", import.meta.url), "utf8"))

function check({ name, extension, dynamic, value, importer = "entry", escaped = false, debug = false, prefix = "leaf-" }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-url-")))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], jsx: "preserve", allowImportingTsExtensions: true, noEmit: true },
      include: ["*.vibe", "*.ts", "*.tsx"]
    }))
    const specifier = "./" + prefix + name + "." + extension
    writeFileSync(join(root, prefix + name + "." + extension), "export const value = " + value + "\n")
    let quoted = JSON.stringify(specifier)
    if (escaped) quoted = quoted.replace(/[^\x00-\x7f]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))
    const source = "import { value } from " + quoted + "\nexport const result = value\n"
    const nativeEntry = importer + ".vibe"
    const twinEntry = "twin-" + importer + ".ts"
    writeFileSync(join(root, nativeEntry), source)
    writeFileSync(join(root, twinEntry), source)
    for (const [file, target] of [["control.mjs", "./" + twinEntry], ["native.mjs", "./" + nativeEntry]]) {
      const program = dynamic
        ? "const module = await import(new URL(" + JSON.stringify("./" + encodeURIComponent(target.slice(2))) + ", import.meta.url).href); console.log(module.result);\n"
        : "import { result } from " + JSON.stringify(target) + "; console.log(result);\n"
      writeFileSync(join(root, file), program)
    }
    const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), VIBELANG_BUN_DEBUG: debug ? "1" : "" }
    delete env.NODE_TEST_CONTEXT
    const run = args => spawnSync(bun, args, { cwd: root, env, encoding: "utf8", timeout: 20000 })
    const typed = spawnSync(process.execPath, [stock, "--noEmit", "--strict", "--target", "es2022",
      "--module", "esnext", "--moduleResolution", "bundler", "--jsx", "preserve",
      "--allowImportingTsExtensions", "--skipLibCheck", twinEntry],
      { cwd: root, env, encoding: "utf8", timeout: 20000 })
    assert.equal(typed.status, 0, typed.stdout + typed.stderr)
    const twin = run(["control.mjs"])
    assert.equal(twin.status, 0, twin.stdout + twin.stderr)
    assert.equal(twin.stdout.trim(), String(value))
    const actual = run(["--preload", preload, "native.mjs"])
    assert.equal(actual.status, 0, actual.stdout + actual.stderr)
    assert.equal(actual.stdout, twin.stdout, "native imports retain the TypeScript sibling's value")
    if (debug) {
      const summary = actual.stderr.split("\n").find(line => line.startsWith('vibelang/bun: {"stage":"source-imports"'))
      assert.ok(summary, actual.stderr)
      const counts = JSON.parse(summary.slice("vibelang/bun: ".length))
      assert.ok(counts.typescriptSiblingResolutions > 0)
      assert.ok(["utf8-bytes", "unicode"].includes(counts.importPathEncoding))
      assert.ok(!actual.stderr.includes("leaf-"), "debug summary omits source filenames")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("BunTypeScriptSiblingImportsQuoted", () => {
  assert.ok(readFileSync(SpecPath("000-intro.md"), "utf8").includes(rule))
  assert.equal(regression.rule, rule)
})
test("Bun native modules resolve a TypeScript sibling without an emitted JavaScript file", { skip }, () => check(regression.input))
test("Alchemy retained foreign TypeScript imports do not become file URL filesystem paths", { skip }, () => {
  const witness = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-bun-foreign-file-url.json", import.meta.url)))
  check(witness.input)
})
for (const importer of ["space source", "percent%25source"]) {
  test("Bun TypeScript sibling resolution keeps the source filename " + importer, { skip }, () => check({ ...regression.input, importer }))
}
test("Bun sibling imports escape dynamic source URL filenames", { skip }, () => check({ ...regression.input, importer: "hash#source", dynamic: true }))
test("Bun sibling imports preserve escaped Unicode names", { skip }, () => check({ ...regression.input, name: "snow-雪", escaped: true }))
test("Bun source resolution diagnostics report counts without source text", { skip }, () => check({ ...regression.input, debug: true }))
test("Bun native and TypeScript imports agree across filenames and import forms", { skip }, async () => {
  await checkProperty(fc, {
    name: "bun-typescript-siblings", rule,
    command: "node --test packages/compiler/test/bun-typescript-sibling.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    arbitrary: fc.record({
      name: fc.constantFrom("plain", "space name", "snow-雪", "percent%25name", "hash#name", "latin-Ã©"),
      extension: fc.constantFrom("ts", "tsx"),
      importer: fc.constantFrom("entry", "space source", "snow-雪", "percent%25source", "hash#source"),
      dynamic: fc.boolean(), escaped: fc.boolean(), value: fc.integer({ min: -100, max: 100 })
    }),
    numRuns: 32, check
  })
})
