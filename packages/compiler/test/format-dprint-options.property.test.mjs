import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { typescriptPlugin } from "../format.mjs"

// A .vibe file with no VibeLang syntax formats under a dprint.json exactly as
// dprint's TypeScript plugin formats the same text as a .ts file under that
// configuration: vibelang-format must not drop the project's options.
const native = fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"
const cli = fileURLToPath(new URL("../bin/vibelang-format", import.meta.url))
const dprintBin = createRequire(import.meta.url).resolve("dprint/bin.cjs")

const source = [
  "export const point = { x: 1, y: 2, label: 'a point with a long enough name to wrap', tags: ['one', 'two', 'three'] }",
  "export function area(width: number, height: number) { if (width < 0) { return 0 } return width * height }",
  "export const pairs = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18]]",
  "",
].join("\n")
const options = fc.record({
  indentWidth: fc.option(fc.constantFrom(2, 4), { nil: undefined }),
  useTabs: fc.option(fc.boolean(), { nil: undefined }),
  newLineKind: fc.option(fc.constantFrom("lf", "crlf"), { nil: undefined }),
  lineWidth: fc.option(fc.constantFrom(40, 80, 120), { nil: undefined }),
  typescript: fc.record({
    trailingCommas: fc.option(fc.constantFrom("never", "always", "onlyMultiLine"), { nil: undefined }),
    semicolons: fc.option(fc.constantFrom("asi", "always", "prefer"), { nil: undefined }),
    quoteStyle: fc.option(fc.constantFrom("alwaysDouble", "alwaysSingle"), { nil: undefined }),
    "arrayExpression.preferSingleLine": fc.option(fc.boolean(), { nil: undefined }),
  }, { requiredKeys: [] }),
}, { requiredKeys: [] })
const defined = (object) => JSON.parse(JSON.stringify(object))

test("vibelang-format applies a dprint.json's options to .vibe as dprint does to .ts", { skip, timeout: 600_000 }, () => {
  fc.assert(fc.property(options, (written) => {
    const config = defined(written)
    const dir = mkdtempSync(join(tmpdir(), "vibe-format-dprint-options-"))
    try {
      mkdirSync(join(dir, ".git"))
      writeFileSync(join(dir, "dprint.json"), JSON.stringify(config))
      writeFileSync(join(dir, "m.vibe"), source)
      const formatted = spawnSync(process.execPath, [cli, "--write", "m.vibe"], { cwd: dir, encoding: "utf8" })
      assert.equal(formatted.status, 0, formatted.stderr)
      // The oracle: the TypeScript plugin alone, the same options, a .ts copy.
      // VibeLang writes semicolons "asi" when the configuration sets none.
      const oracle = join(dir, "oracle.json")
      const typescript = { semicolons: "asi", ...config.typescript }
      writeFileSync(oracle, JSON.stringify({ ...config, typescript, plugins: [typescriptPlugin] }))
      const expected = spawnSync(process.execPath, [dprintBin, "fmt", "--config", oracle, "--stdin", join(dir, "m.ts")], { input: source, cwd: dir, encoding: "utf8" })
      assert.equal(expected.status, 0, expected.stderr)
      assert.equal(readFileSync(join(dir, "m.vibe"), "utf8"), expected.stdout, JSON.stringify(config))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }), { numRuns: 24, seed: 4089 })
})
