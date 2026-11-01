import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { command, defaultCompiler, linkModules } from "./check-snippets"

test("RD-003: migration rules retire the service-lookup and native-clock blockers", () => {
  const text = readFileSync(new URL("../../.smithers/flows/migrate/rules.md", import.meta.url), "utf8")
  expect(text).not.toContain("is EK0502")
  expect(text).not.toContain("EK4403 rejects them")
  expect(text).toContain("controllable tests")
})

test("RD-003 property: injected service lookups and plain native time helpers compile", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  await fc.assert(fc.asyncProperty(fc.stringMatching(/^[A-Z][a-z]{1,8}$/), fc.integer({ min: 0, max: 999 }), async (name: string, value: number) => {
    const temp = mkdtempSync(join(tmpdir(), "docs-transition-property-"))
    try {
      linkModules(temp)
      writeFileSync(join(temp, "package.json"), '{"type":"module","name":"docs-transition-property"}')
      writeFileSync(join(temp, "main.vibe"), [
        'service ' + name + ' { get(): number!! }',
        'export effect function lookup() { const service = try ' + name + '; return try service.get() }',
        'export function now(): number { return Date.now() }',
        'export function random(): number { return Math.random() }',
        'export { ' + name + ' }'
      ].join("\n"))
      writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out" }, files: ["main.vibe"]
      }))
      expect(await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)).toMatchObject({ exitCode: 0 })
      writeFileSync(join(temp, "oracle.mjs"), 'import assert from "node:assert/strict"; import { Effect } from "effect"; import { lookup, ' + name + ' } from "./out/main.js"; assert.equal(await Effect.runPromise(Effect.provideService(lookup(), ' + name + ', { get: () => Effect.succeed(' + value + ') })), ' + value + ')')
      expect((await command(["node", "oracle.mjs"], temp, 30000)).exitCode).toBe(0)
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 8, seed: 4003 })
}, 60000)

