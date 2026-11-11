// A module declaration's output shares its file's diagnostics (VIP-40): a
// loader fails main.vibe.text.js on main.vibe's errors, and the outputs of a
// .vibex module's declarations, .js or .jsx under preserved JSX, on the
// .vibex file's.
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { diagnosticsForFile } from "../diagnostics.mjs"

const files = ["/app/src/main.vibe", "/app/src/view.vibex", "/app/src/other.vibe"]
const diagnostics = files.map((file) => ({ file, code: 2322, category: "error" }))
const of = (output) => diagnosticsForFile(diagnostics, output, files).map(({ file }) => file)

test("a module declaration's output reports its .vibe or .vibex file's diagnostics", () => {
  assert.deepEqual(of("/app/src/main.vibe.text.js"), ["/app/src/main.vibe"])
  assert.deepEqual(of("/app/src/view.vibex.text.js"), ["/app/src/view.vibex"])
  assert.deepEqual(of("/app/src/view.vibex.-54-ext.jsx"), ["/app/src/view.vibex"])
  assert.deepEqual(of("/app/src/view.vibex"), ["/app/src/view.vibex"])
  // A file named like an output of no .vibe or .vibex file is its own module.
  assert.deepEqual(of("/app/src/view.tsx.text.js"), [])
})
