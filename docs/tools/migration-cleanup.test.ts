import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import fc from "fast-check"
import { command, defaultCompiler, linkModules } from "./check-snippets"

const repository = resolve(import.meta.dir, "../..")
const reviewRoot = process.env.DOCS_REVIEW_ROOT || repository
const tick = String.fromCharCode(96)

test("migration guidance keeps Effect cleanup combinators", () => {
  for (const name of ["rules.md", "context.md"]) {
    const text = readFileSync(join(reviewRoot, ".smithers/flows/migrate", name), "utf8")
    const retired = text.split("\n").filter(line => /\x60try\x60\/\x60finally\x60\s+instead of\s+\x60ensuring\x60/.test(line))
    expect(retired).toEqual([])
    expect(text).toContain("For Effect cleanup")
    expect(text).toContain(tick + "ensuring" + tick + " or " + tick + "onExit" + tick)
    expect(text).toContain("plain and " + tick + "async" + tick + " functions")
  }
})

test("the cleanup oracle quotes accepted VIP-5", () => {
  const vip = readFileSync(join(repository, "docs/design/vips/0005-try-runs-effects.md"), "utf8")
  expect(vip).toContain("no " + tick + "try" + tick + " statements of any kind")
  expect(vip).toContain("Cleanup uses Effect's " + tick + "ensuring" + tick + " or " + tick + "onExit" + tick)
})

// VIP-5: "Cleanup uses Effect's ensuring or onExit" (code quotes checked above).
// Constructing the program runs no cleanup; running it preserves its success or failure.
test("Effect cleanup stays cold and preserves success and typed failure", async () => {
  const outcomes = new Set<boolean>()
  await fc.assert(fc.asyncProperty(fc.integer({ min: -128, max: 128 }), fc.boolean(), async (value, fail) => {
    outcomes.add(fail)
    const dir = mkdtempSync(join(tmpdir(), "docs-cleanup-"))
    try {
      linkModules(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      writeFileSync(join(dir, "main.vibe"), [
        'export error Failed { value: number }',
        'effect function work(): number!Failed { if (' + fail + ') throw new Failed({ value: ' + value + ' }); return ' + value + ' }',
        'export effect function run(cleanup: void!!): number!Failed { return try Effect.ensuring(work(), cleanup) }',
        'export function plain(): number { try { return ' + value + ' } finally {} }',
        'export async function asyncPlain(): Promise<number> { try { return ' + value + ' } finally {} }'
      ].join("\n"))
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "NodeNext", target: "ESNext", skipLibCheck: true, types: [], outDir: "out" }, files: ["main.vibe"]
      }))
      expect(await command([defaultCompiler(), "--singleThreaded", "--pretty", "false", "-p", "tsconfig.json"], dir, 30000)).toMatchObject({ exitCode: 0 })
      writeFileSync(join(dir, "oracle.mjs"), [
        'import assert from "node:assert/strict"; import {Effect} from "effect"; import {run,plain,asyncPlain,Failed} from "./out/main.js";',
        'const events=[]; const referenceEvents=[];',
        'const cleanup=Effect.sync(()=>{ events.push("cleanup") });',
        'const program=run(cleanup); assert.deepEqual(events,[]);',
        'const reference=Effect.ensuring(' + (fail ? 'Effect.fail(new Failed({value:' + value + '}))' : 'Effect.succeed(' + value + ')') + ',Effect.sync(()=>{referenceEvents.push("cleanup")}));',
        'assert.deepEqual(referenceEvents,[]);',
        'const actual=Effect.runSync(' + (fail ? 'Effect.flip(program)' : 'program') + ');',
        'const expected=Effect.runSync(' + (fail ? 'Effect.flip(reference)' : 'reference') + ');',
        fail ? 'assert.equal(actual._tag,"Failed"); assert.equal(actual.value,expected.value); assert.equal(actual.value,' + value + ');' : 'assert.equal(actual,expected); assert.equal(actual,' + value + ');',
        'assert.deepEqual(events,["cleanup"]); assert.deepEqual(events,referenceEvents);',
        'assert.equal(plain(),' + value + '); assert.equal(await asyncPlain(),' + value + ');'
      ].join("\n"))
      expect(await command(["node", "oracle.mjs"], dir, 30000)).toMatchObject({ exitCode: 0, stdout: "", stderr: "" })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }), { numRuns: 8, seed: 51089 })
  expect(outcomes).toEqual(new Set([false, true]))
}, 60000)
