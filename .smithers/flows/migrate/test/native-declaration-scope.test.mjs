import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { batchScope, foreignChanges } from "../lib/touched.mjs"

// The compiler writes x.d.ts beside each .vibe module's sidecar, so that
// stock TypeScript resolves a native importer's ./x.js (VIP-27). A batch that
// converts x.ts owns that file and its ownership receipt; the same file for
// a module the batch did not convert stays foreign.
const receipt = (directory, name) => `${directory}/.vibelang-sidecar-${createHash("sha256").update(name).digest("hex")}-${"0".repeat(64)}.owner`

test("a converted module's native declaration is in its batch's scope, beside the source", () => {
  const files = [{ path: "src/context.ts", planned: "src/context.vibe" }]
  const scope = batchScope({ files })
  assert.ok(scope.has("src/context.d.ts"))
  const added = [
    { status: "added", path: "src/context.d.ts" },
    { status: "added", path: receipt("src", "context.d.ts") },
    { status: "added", path: "src/other.d.ts" },
  ]
  assert.deepEqual(foreignChanges(added, { files }), [{ status: "added", path: "src/other.d.ts" }])
})

test("a converted module's native declaration is in scope under vibe.sidecarDir, and .vibex too", () => {
  const files = [{ path: "src/app.tsx", planned: "src/app.vibex" }]
  const sidecar = (path) => /\.vibex?$/.test(path) ? ".vibe/declarations/" + path.replace(/\.vibex?$/, extension => ".d" + extension + ".ts") : null
  const scope = batchScope({ files, sidecar })
  assert.ok(scope.has(".vibe/declarations/src/app.d.vibex.ts"))
  assert.ok(scope.has(".vibe/declarations/src/app.d.ts"))
})

test("a module that stays TypeScript gets no native declaration in scope", () => {
  const files = [{ path: "src/kept.ts", planned: "src/kept.ts" }]
  assert.equal(batchScope({ files }).has("src/kept.d.ts"), false)
})
