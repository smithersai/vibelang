import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const modules = ["packages/compiler/relative-imports.mjs", "packages/unplugin/src/relative-imports.js", "packages/vite/src/relative-imports.js"]
const resolvers = await Promise.all(modules.map((name) => import(new URL("../../../" + name, import.meta.url))))
const bun = spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0

// OpenCode's prompt.txt regression: these are existing non-directory assets,
// not script candidates. Every resolver must defer; a sibling extensionless
// .vibe positive control ensures this does not disable ordinary resolution.
function check(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-asset-property-")))
  const directory = join(root, "app")
  const specifier = "./" + input.path + "." + input.extension
  const asset = join(directory, input.path + "." + input.extension)
  mkdirSync(dirname(asset), { recursive: true })
  writeFileSync(asset, "asset\n")
  writeFileSync(join(directory, "program.vibe"), "export const value = 1\n")
  const program = join(directory, "program.vibe")
  try {
    for (const { extensionlessImport } of resolvers) {
      assert.equal(extensionlessImport(directory, specifier), undefined)
      assert.equal(extensionlessImport(directory, "./program"), program)
    }
    if (bun) {
      const script = [
        "const modules = " + JSON.stringify(modules.map((name) => join(repo, name))),
        "const results = []",
        "for (const module of modules) {",
        "  const { extensionlessImport } = await import(module)",
        "  results.push([extensionlessImport(" + JSON.stringify(directory) + ", " + JSON.stringify(specifier) + ") ?? null, extensionlessImport(" + JSON.stringify(directory) + ", './program')])",
        "}",
        "console.log(JSON.stringify(results))"
      ].join("\n")
      const result = spawnSync("bun", ["-e", script], { encoding: "utf8", timeout: 10000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), modules.map(() => [null, program]))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode-15: Node and Bun resolvers defer non-script assets without ENOTDIR", async () => {
  const part = fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/)
  const path = fc.array(part, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"))
  await checkProperty(fc, {
    name: "NonScriptAssetResolution",
    rule: "Existing non-script files belong to the host loader; a Vibe resolver defers without treating the file as a directory (OpenCode-15).",
    command: "node --test packages/compiler/test/relative-assets.property.test.mjs",
    arbitrary: fc.record({ path, extension: fc.constantFrom("txt", "css", "svg", "md", "json", "wasm") }),
    check,
    numRuns: 70,
    regressions: new URL("./property-regressions/", import.meta.url),
    artifacts: (input) => ({ "input.json": JSON.stringify(input, null, 2) + "\n" })
  })
})
