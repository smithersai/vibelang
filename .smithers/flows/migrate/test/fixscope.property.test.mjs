import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"

// fixToFixedPoint's contract: --fix rewrites every .vibe file its project
// reaches, and the batch keeps only its own files' rewrites; every other
// .vibe file, in this package or another, stays as committed. drive-t3code-server
// (19:16Z) found the other-package half broken on the 534-file server batch.
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

const layout = fc.record({
  packages: fc.uniqueArray(fc.constantFrom("apps/server", "apps/web", "packages/contracts", "packages/shared", "infra/relay"), { minLength: 1, maxLength: 4 }),
  files: fc.uniqueArray(fc.constantFrom("src/a.vibe", "src/b.vibe", "src/deep/c.vibe", "index.vibe"), { minLength: 1, maxLength: 3 }),
  batchShare: fc.integer({ min: 0, max: 3 }),
  rewritten: fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
})

test("fixToFixedPoint keeps the batch's rewrites and puts back every other .vibe file in the repository", async () => {
  await fc.assert(fc.asyncProperty(layout, async (input) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-fix-scope-property-"))
    try {
      const all = input.packages.flatMap((pkg) => input.files.map((file) => posix.join(pkg, file)))
      const cwdPackage = input.packages[0]
      const batch = all.filter((file, i) => file.startsWith(cwdPackage + "/") && i < input.batchShare + 1)
      for (const file of all) {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        writeFileSync(join(root, file), `export const committed = ${JSON.stringify(file)}\n`)
      }
      const touched = all.filter((_, i) => input.rewritten[i % input.rewritten.length] || batch.includes(all[i]))
      const compiler = join(root, "fake-vibelang")
      writeFileSync(compiler, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
const root = ${JSON.stringify(root)}
let n = 0
for (const file of ${JSON.stringify(touched)}) {
  const abs = path.join(root, file), text = fs.readFileSync(abs, "utf8")
  if (text.includes("// fixed")) continue
  fs.writeFileSync(abs, text + "// fixed\\n")
  console.log("vibelang --fix: " + path.relative(process.cwd(), abs) + ": 1 fix (EK4837 ×1)")
  n++
}
console.log("vibelang --fix: " + n + " fixes in " + n + " files.")
`)
      chmodSync(compiler, 0o755)
      const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(root, cwdPackage), root, only: batch })
      for (const file of all) {
        const text = readFileSync(join(root, file), "utf8")
        const fixed = batch.includes(file)
        assert.equal(text.includes("// fixed"), fixed, `${file} ${fixed ? "keeps" : "loses"} its rewrite`)
      }
      assert.deepEqual(Object.keys(result.byFile).sort(), batch.filter((f) => touched.includes(f)).sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 1916, numRuns: 60 })
})
