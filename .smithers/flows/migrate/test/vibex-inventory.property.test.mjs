import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { buildInventory, listSources } from "../lib/inventory.mjs"
import { resolveFile } from "../lib/imports.mjs"
import { migrationScope } from "../lib/plan.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vibex-inventory.json", import.meta.url), "utf8"))
const packages = [{ dir: ".", sources: ["src"] }]

function fixture(files, run) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-inventory-"))
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    run(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Vibex inventory follows the accepted file-kind and resolution rules", () => {
  const vip = readFileSync(new URL("../../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8")
  assert.ok(vip.includes("Every VibeLang production is exactly `.vibe`'s."))
  assert.ok(vip.includes("Resolution treats `.vibex` as `.vibe`'s `.tsx`"))
})

test("opencode JSX inventory retains migrated sources, test edges and scope counts", () => {
  fixture(corpus.files, root => {
    assert.deepEqual(listSources(root, "src"), corpus.sources)
    const inventory = buildInventory({ root, packages })
    assert.equal(inventory.summary.files, 3)
    assert.equal(inventory.summary.effectValueFiles, 1)
    const leaf = inventory.files.find(file => file.path === corpus.dependency)
    assert.ok(leaf)
    assert.deepEqual(leaf.dependents, [corpus.dependent])
    assert.deepEqual(leaf.testedBy, [corpus.dependent])
    const scope = migrationScope(inventory, { batches: [] })
    assert.equal(scope.counts.owned, 3)
    assert.equal(scope.counts.effectImports, 1)
    assert.deepEqual(scope.owned.map(file => file.path), corpus.sources)
  })
})

test("Vibex graph resolution matches TypeScript twins across source and output specifiers", () => {
  fc.assert(fc.property(fc.record({
    depth: fc.integer({ min: 0, max: 3 }),
    name: fc.constantFrom("Leaf", "View", "Widgeté"),
    extension: fc.constantFrom(".vibe", ".vibex"),
    form: fc.constantFrom("source", "extensionless", ".js", ".jsx"),
    directory: fc.boolean(),
  }), input => {
    const stem = ["src", ...Array.from({ length: input.depth }, (_, i) => "d" + i), input.name].join("/")
    const target = stem + (input.directory ? "/index" : "") + input.extension
    const nativeExtension = input.extension === ".vibex" ? ".tsx" : ".ts"
    const nativeTarget = target.slice(0, -input.extension.length) + nativeExtension
    const specifier = input.form === "source" ? target : input.form === "extensionless" ? stem : stem + input.form
    const nativeSpecifier = input.form === "source" ? nativeTarget : specifier
    // Output-extension substitution applies to files, while an extensionless
    // import may select a directory's index.
    if (input.directory && input.form !== "extensionless" && input.form !== "source") return
    fixture({
      "package.json": '{"type":"module"}',
      [target]: 'import { Effect } from "effect"\nexport const value = Effect.succeed(1)\n',
      [nativeTarget]: "export const value = 1\n",
      "src/use.test.tsx": 'import { value } from "../' + specifier + '"\nexport const observed = value\n',
      "src/generated.d.vibex.ts": "export declare const value: number\n",
      "src/node_modules/hidden.vibex": "export const hidden = 1\n",
      "src/dist/hidden.vibex": "export const hidden = 1\n",
    }, root => {
      const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve }
      const twin = ts.resolveModuleName("./" + nativeSpecifier, join(root, "entry.tsx"), options, ts.sys).resolvedModule
      assert.equal(twin?.resolvedFileName, join(root, nativeTarget), JSON.stringify(input))
      assert.equal(resolveFile(specifier, new Set([target])), target, JSON.stringify(input))
      const inventory = buildInventory({ root, packages })
      assert.equal(inventory.files.length, 3)
      const leaf = inventory.files.find(file => file.path === target)
      assert.ok(leaf)
      // A written native twin remains the first candidate for JS and
      // extensionless imports; an explicit VibeLang source selects itself.
      const selected = input.form === "source" ? target : nativeTarget
      const consumer = inventory.files.find(file => file.path === "src/use.test.tsx")
      assert.deepEqual(consumer.imports, [selected])
      const retained = inventory.files.find(file => file.path === selected)
      assert.deepEqual(retained.testedBy, ["src/use.test.tsx"])
    })
  }), { seed: 32639, numRuns: 120, endOnFailure: true })
})
