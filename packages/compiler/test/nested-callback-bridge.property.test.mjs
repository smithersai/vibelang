import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-alloydb-nested-callback.json", import.meta.url), "utf8"))
function witness({ parentheses, blockBody, parameter }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-nested-callback-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"), "junction")
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"), "junction")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "foreign.ts"), 'import type * as Effect from "effect/Effect"; export const make=<R>(options:{execute:(sql:string)=>Effect.Effect<string,never,R>})=>options;')
    const nested = "(".repeat(parentheses) + "effect { return " + parameter + " }" + ")".repeat(parentheses)
    const body = blockBody ? "{ return try " + nested + " }" : "try " + nested
    writeFileSync(join(root, "main.vibe"), 'import {make} from "./foreign.ts"\nexport const probe=effect ()=>try Effect.orDie(Effect.try({try:()=>make({execute:effect (' + parameter + ")=>" + body + '}),catch:(error)=>error}))\n')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", noEmit: true, types: [], rewriteRelativeImportExtensions: true },
      files: ["main.vibe", "foreign.ts"]
    }))
    const result = spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 15000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("a native callback inside a foreign bridge runs its own nested effect block", () => witness(corpus))
test("nested callback blocks retain their effect type through expression trivia and body forms", () => {
  fc.assert(fc.property(fc.record({
    parentheses: fc.integer({ min: 0, max: 3 }), blockBody: fc.boolean(),
    parameter: fc.constantFrom("sql", "query", "$text")
  }), witness), { seed: 20261109, numRuns: 24 })
})
