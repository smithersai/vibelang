import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/" + (process.platform === "win32" ? "vibelang.exe" : "vibelang"), import.meta.url))
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/foldkit-incremental-compiler-identity.json", import.meta.url), "utf8"))
const quote = "apply throughout `.vibe`, including plain functions and wrapper arrows (VIP-33)."

test("incremental checks retain the specified platform restrictions", () => {
  assert.ok(readFileSync(SpecPath("000-intro.md"), "utf8").includes(quote))
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-incremental-diagnostics-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    const property = input.member
    const source = input.boundary
      ? "export const " + input.name + " = (): boolean => Boolean(import.meta." + property + ");\n"
      : "export const " + input.name + " = (): boolean => true;\n"
    writeFileSync(join(root, "src", "index." + input.kind), source)
    writeFileSync(join(root, "src", "vite-env.d.ts"), "interface ImportMeta { readonly " + property + ": object | undefined }\n")
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, composite: true, incremental: true, declaration: true,
        module: "NodeNext", target: "ES2022", rootDir: "src", outDir: "dist",
        tsBuildInfoFile: "state.tsbuildinfo", types: [] },
      files: ["src/index." + input.kind, "src/vite-env.d.ts"],
    }))
    const invoke = (binary, flags) => {
      const p = spawnSync(binary, ["--singleThreaded", "--pretty", "false", "-p", "tsconfig.json", ...flags],
        { cwd: root, encoding: "utf8" })
      assert.ok(!p.error, p.error?.message)
      assert.equal(p.signal, null)
      const output = p.stdout + p.stderr
      const diagnostics = [...output.matchAll(/([^\n]+?)\((\d+),(\d+)\): error ((?:EK|TS)\d+):/g)]
        .map(m => [m[1], Number(m[2]), Number(m[3]), m[4]])
      return { status: p.status, diagnostics, output }
    }
    const cold = invoke(native, ["--composite", "false", "--incremental", "false", "--noEmit"])
    if (input.boundary && input.kind === "vibe") {
      assert.equal(cold.status, 2, cold.output)
      assert.deepEqual(cold.diagnostics.map(d => d[3]), ["EK4402"], cold.output)
    } else {
      assert.equal(cold.status, 0, cold.output)
      assert.deepEqual(cold.diagnostics, [], cold.output)
    }
    const primed = invoke(native, [])
    assert.equal(primed.status, cold.status, primed.output)
    assert.deepEqual(primed.diagnostics, cold.diagnostics)
    const cache = readFileSync(join(root, "state.tsbuildinfo"), "utf8")
    assert.ok(cache.length > 0)
    for (let step = 0; step < 2; step++) {
      const warm = invoke(native, ["--noEmit"])
      assert.equal(warm.status, cold.status, fixture.key + ": warm exit must match fresh: " + warm.output)
      assert.deepEqual(warm.diagnostics, cold.diagnostics, fixture.key + ": warm diagnostics must match fresh")
    }
    // This is a byte-identical executable at another path, a positive control.
    // It is not the semantically different SDK60→main artifact-switch witness.
    const same = join(root, "same-native")
    linkSync(native, same)
    const relocated = invoke(same, ["--noEmit"])
    assert.equal(relocated.status, cold.status, relocated.output)
    assert.deepEqual(relocated.diagnostics, cold.diagnostics)
    assert.equal(readFileSync(join(root, "state.tsbuildinfo"), "utf8"), cache)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test(fixture.key + ": the minimized source retains diagnostics in a same-artifact warm cache", () => {
  check(fixture.input)
})
test("native TypeScript and platform-free functions remain passing controls", () => {
  check({ ...fixture.input, kind: "ts" })
  check({ ...fixture.input, boundary: false })
})
test("warm/fresh checks vary source names, metadata properties and native source kind", () => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("isHot", "isDevelopment", "hasMetadata"),
    member: fc.constantFrom("hot", "env", "pluginState"),
    kind: fc.constantFrom("ts", "vibe"), boundary: fc.boolean(),
  }), check), { seed: 123123, numRuns: 12, endOnFailure: true })
})
