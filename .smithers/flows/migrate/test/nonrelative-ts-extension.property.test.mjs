import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { pathAliases, rewriteImports } from "../lib/codemod.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/" + (process.platform === "win32" ? "vibelang.exe" : "vibelang"), import.meta.url))
const fixture = JSON.parse(readFileSync(new URL("./corpus/t3code-nonrelative-ts-extension.json", import.meta.url), "utf8"))
const quote = "TypeScript's own lexical, syntax and static errors on ordinary native syntax keep their " + String.fromCharCode(96) + "TS" + String.fromCharCode(96) + " codes, including independent errors in embedded expressions and types."

test("alias spelling uses the spec's native TypeScript diagnostic contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "t3code-retained-alias-"))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  try {
    const dir = "nested/".repeat(input.depth)
    const leaf = dir + input.name
    const importer = dir + "main." + input.kind
    const target = leaf + "." + input.target
    const specifier = input.relative ? "./" + input.name : input.prefix + leaf
    const source = 'import { value } from ' + JSON.stringify(specifier) + ';\nexport const result = value;\n'
    const options = { module: "ESNext", moduleResolution: "Bundler", target: "ES2022", types: [],
      strict: true, skipLibCheck: true, rewriteRelativeImportExtensions: true,
      paths: { [input.prefix + "*"]: ["./*"] } }
    put("package.json", '{"type":"module"}')
    put("tsconfig.json", JSON.stringify({ compilerOptions: options, files: [importer] }))
    put(importer, source)
    put(leaf + ".ts", "export const value = 1;\n")
    const compile = () => {
      const r = spawnSync(native, ["--singleThreaded", "--pretty", "false", "--noEmit", "-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
      assert.equal(r.signal, null)
      assert.ok(!r.error, r.error?.message)
      return { status: r.status, output: r.stdout + r.stderr }
    }
    // Start from a valid native dependency before the target migration.
    const beforeText = readFileSync(join(root, importer), "utf8")
    const before = compile()
    assert.equal(before.status, 0, "original must compile: " + before.output)
    if (input.target === "vibe") renameSync(join(root, leaf + ".ts"), join(root, target))
    const edits = rewriteImports(root, [importer, target], [importer], pathAliases(ts, root))
    const afterText = readFileSync(join(root, importer), "utf8")
    const after = compile()
    // Decided detail 272: a module that stays TypeScript keeps the specifier
    // the repository wrote, from a .vibe importer as from a .ts one. T3code's
    // ~/leaf in a migrated importer once gained .ts and failed with TS2877.
    assert.equal(after.status, 0, fixture.key + ": retain a valid resolved import: " + after.output)
    if (input.target === "ts") {
      assert.deepEqual(edits, [], fixture.key + ": a retained TypeScript target keeps its written specifier")
      assert.equal(afterText, beforeText)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test(fixture.key, () => check(fixture.input))
test("retained and migrated targets vary alias prefixes, native importers and relative controls", () => {
  for (const kind of ["ts", "vibe"]) for (const target of ["ts", "vibe"]) for (const relative of [true, false]) {
    check({ ...fixture.input, kind, target, relative })
  }
})
test("alias neighbours vary directory depth and basename without losing module identity", () => {
  fc.assert(fc.property(fc.record({
    prefix: fc.constantFrom("~/", "@/", "#app/"), depth: fc.integer({ min: 0, max: 3 }),
    name: fc.constantFrom("leaf", "filesystem", "previewRuntime", "assetUrls"),
    kind: fc.constantFrom("ts", "vibe"), target: fc.constantFrom("ts", "vibe"), relative: fc.boolean(),
  }), check), { seed: 28772877, numRuns: 24, endOnFailure: true })
})


test("compiler discovery honors an override and the checkout build", () => {
  const args = ["--test", "--test-name-pattern=^" + fixture.key + "$", fileURLToPath(import.meta.url)]
  const missing = mkdtempSync(join(tmpdir(), "retained-alias-compiler-"))
  try {
    for (const explicit of [false, true]) {
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      if (explicit) env.VIBELANG_BINARY = native
      else delete env.VIBELANG_BINARY
      const r = spawnSync(process.execPath, args, { env, encoding: "utf8" })
      assert.ok(!r.error, r.error?.message)
      assert.equal(r.status, 0, "compiler discovery " + (explicit ? "override" : "default") + ": " + r.stdout + r.stderr)
      assert.match(r.stdout, /\bpass 1\b/, "the real compiler witness must execute")
    }
    const absent = join(missing, "absent-compiler")
    const env = { ...process.env, VIBELANG_BINARY: absent }
    delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, args, { env, encoding: "utf8" })
    assert.ok(!r.error, r.error?.message)
    assert.notEqual(r.status, 0, "an invalid explicit override must not fall back or skip")
    assert.ok((r.stdout + r.stderr).includes(absent), r.stdout + r.stderr)
    assert.match(r.stdout + r.stderr, /ENOENT/, "the explicit compiler failure must remain visible")
  } finally {
    rmSync(missing, { recursive: true, force: true })
  }
})
