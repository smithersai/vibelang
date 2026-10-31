import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const modules = ["packages/compiler/relative-imports.mjs", "packages/vite/src/relative-imports.js", "packages/unplugin/src/relative-imports.js"].map(path => join(repo, path))
const rule = 'docs/design/src/007-tooling.md: "Existing tools work."; opencode-15: non-script assets retain host resolution'
let diagnostics = ""

function filesOf(input) {
  return {
    [(input.nested ? "assets/" : "") + input.asset]: input.contents,
    [input.parent ? "app/importer.ts" : "importer.ts"]: "import content from " + JSON.stringify((input.parent ? "../" : "./") + (input.nested ? "assets/" : "") + input.asset) + ' with { type: "text" }\nconsole.log(content)\n' 
  }
}

test("asset import oracle quotes the current specification", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes("Existing tools work."))
})

test("all source loaders leave generated asset imports to Bun (opencode-15)", async () => {
  await checkProperty(fc, {
    name: "bun-asset-imports", rule,
    regressions: new URL("./property-regressions/", import.meta.url),
    command: "node --test test/asset-imports.property.test.mjs",
    arbitrary: fc.record({
      asset: fc.constantFrom("prompt.txt", "logo.svg", "data.json", "theme.css", "README", "input.md", "blob.bin"),
      nested: fc.boolean(), parent: fc.boolean(),
      contents: fc.string({ maxLength: 40 })
    }), numRuns: 60,
    diagnostics: () => diagnostics, artifacts: filesOf,
    check: input => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-assets-property-")))
      try {
        for (const [file, contents] of Object.entries(filesOf(input))) {
          mkdirSync(dirname(join(root, file)), { recursive: true })
          writeFileSync(join(root, file), contents)
        }
        const from = input.parent ? join(root, "app") : root
        const specifier = (input.parent ? "../" : "./") + (input.nested ? "assets/" : "") + input.asset
        const script = "const results = []; for (const path of " + JSON.stringify(modules) +
          ") { const { extensionlessImport } = await import(path); results.push(String(extensionlessImport(" +
          JSON.stringify(from) + ", " + JSON.stringify(specifier) + "))); } console.log(JSON.stringify(results))"
        const result = spawnSync("bun", ["-e", script], {
          cwd: root, encoding: "utf8", timeout: 20000, env: { ...process.env, NO_COLOR: "1" }
        })
        diagnostics = JSON.stringify({ input, specifier, result }).replaceAll(root, "<project>")
        assert.ifError(result.error)
        assert.equal(result.status, 0, diagnostics)
        assert.deepEqual(JSON.parse(result.stdout), modules.map(() => "undefined"), diagnostics)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})
