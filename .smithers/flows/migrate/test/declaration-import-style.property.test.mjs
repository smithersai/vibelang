// Will, 2026-11-02 / VIP-30: declaration spelling follows the TypeScript twin.
// Setup must remove the retired setting instead of inferring a package style.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { removeVibeLangSetting } from "../lib/wire.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const ts = require("typescript")
const fc = require("fast-check")
const parse = text => {
  const result = ts.parseConfigFileTextToJson("tsconfig.json", text)
  assert.equal(result.error, undefined)
  return result.config
}

test("setup removes declarationImportStyle for each source spelling and legacy path", async () => {
  for (const suffix of [".js", "", ".ts"]) {
    for (const nested of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), "declaration-native-"))
      try {
        const put = (file, text) => {
          mkdirSync(join(root, file, ".."), { recursive: true })
          writeFileSync(join(root, file), text)
        }
        put("package.json", JSON.stringify({ name: "fixture", private: true, type: "module" }))
        put("src/main.ts", 'export { value } from "./user' + suffix + '";\n')
        put("src/user.ts", "export const value = 1\n")
        const config = {
          compilerOptions: { strict: true, moduleResolution: "bundler", module: "esnext" },
          include: ["src/**/*.ts"],
        }
        const settings = { declarationImportStyle: "extensionless", trustedPackages: ["@x/*"] }
        if (nested) config.compilerOptions.vibelang = settings
        else config.vibelang = settings
        put("tsconfig.json", JSON.stringify(config))
        mkdirSync(join(root, "node_modules"))
        symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
        execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
        const setup = makeConfig({ target: root, packages: ["."], test: "true", vibelangVersion: "0.0.11", install: "true" })
        const wired = await wireTarget(setup, join(root, ".logs"))
        const after = parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
        assert.equal(after.vibelang?.declarationImportStyle, undefined, suffix)
        assert.equal(after.compilerOptions.vibelang?.declarationImportStyle, undefined, suffix)
        assert.deepEqual((nested ? after.compilerOptions.vibelang : after.vibelang).trustedPackages, ["@x/*"])
        assert.equal(after.compilerOptions.strict, true)
        assert.ok(!wired.warnings.some(w => w.includes("declarationImportStyle")))
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }
})

test("retired setting removal preserves unrelated JSONC configuration and is idempotent", () => {
  fc.assert(fc.property(
    fc.jsonValue(), fc.boolean(), fc.constantFrom("  ", "    ", "\t"),
    (value, nested, indent) => {
      const settings = { declarationImportStyle: value, trustedPackages: ["@x/*"] }
      const before = { compilerOptions: { strict: true }, files: ["main.vibe"] }
      if (nested) before.compilerOptions.vibelang = settings
      else before.vibelang = settings
      const text = "// keep\n" + JSON.stringify(before, null, indent) + "\n"
      const next = removeVibeLangSetting(text, ts, "declarationImportStyle")
      delete settings.declarationImportStyle
      assert.deepEqual(parse(next), before)
      assert.ok(next.includes("// keep"))
      assert.equal(removeVibeLangSetting(next, ts, "declarationImportStyle"), next)
    }
  ), { seed: 110202, numRuns: 300 })
})
