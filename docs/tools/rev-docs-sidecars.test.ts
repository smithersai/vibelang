import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { command, defaultCompiler, linkModules } from "./check-snippets"

test("RD-002: limitations describe the implemented declaration-sidecar route", () => {
  const text = readFileSync(new URL("../user/src/setup/known-limitations.md", import.meta.url), "utf8")
  for (const phrase of ["allowArbitraryExtensions", ".d.vibe.ts", "vibelang-cli.md#let-typescript-tools-read-vibe-modules"]) expect(text).toContain(phrase)
  expect(text).not.toContain("report TS2307 for")
  expect(text).not.toContain("declarations arrives")
})

test("RD-002 property: stock TypeScript resolves emitted sidecars only with arbitrary extensions enabled", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.stringMatching(/^[a-z]{1,8}$/), async (enabled: boolean, name: string) => {
    const temp = mkdtempSync(join(tmpdir(), "docs-sidecar-property-"))
    try {
      linkModules(temp)
      writeFileSync(join(temp, "package.json"), '{"type":"module","name":"docs-sidecar-property"}')
      writeFileSync(join(temp, "greet.vibe"), 'export effect function greet(' + name + ': string) { return "Hello, " + ' + name + ' }')
      writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "nodenext", target: "es2022", skipLibCheck: true, types: [], declaration: true }, files: ["greet.vibe"]
      }))
      expect((await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)).exitCode).toBe(0)
      writeFileSync(join(temp, "consumer.ts"), 'import { greet } from "./greet.vibe"; import { Effect } from "effect"; const program: Effect.Effect<string> = greet("Ada")')
      writeFileSync(join(temp, "stock.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "nodenext", target: "es2022", skipLibCheck: true, types: [], noEmit: true, allowArbitraryExtensions: enabled }, files: ["consumer.ts"]
      }))
      const result = await command(["node", new URL("./node_modules/typescript/bin/tsc", import.meta.url).pathname, "-p", "stock.json"], temp, 30000)
      expect(result.exitCode).toBe(enabled ? 0 : 2)
      if (!enabled) expect(result.stdout).toContain("TS6263")
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 6, seed: 4002 })
}, 60000)

