// A module declaration's output shares its file's diagnostics (VIP-40): a
// loader fails main.vibe.text.js on main.vibe's errors, and the outputs of a
// .vibex module's declarations, .js or .jsx under preserved JSX, on the
// .vibex file's.
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { diagnosticsForFile } from "../diagnostics.mjs"
import { parseOutput } from "../project.mjs"

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


test("diagnosticsForFile and parseOutput match located diagnostics across Windows and POSIX path separators", () => {
  const winFiles = ["C:/app/src/a.vibe", "C:/app/src/b.vibe"]
  const winErrors = [
    { file: "C:\\app\\src\\b.vibe", line: 1, column: 1, category: "error", code: "TS2322", text: "bad b" },
    { file: "C:\\app\\tsconfig.json", line: 1, column: 1, category: "error", code: "TS5023", text: "bad config" },
    { file: undefined, line: 0, column: 0, category: "error", code: "TS18003", text: "global" }
  ]
  assert.deepEqual(
    diagnosticsForFile(winErrors, "C:\\app\\src\\a.vibe", winFiles).map((d) => d.code),
    ["TS5023", "TS18003"],
    "unrelated b.vibe error must not leak to a.vibe"
  )
  assert.deepEqual(
    diagnosticsForFile(winErrors, "C:\\app\\src\\b.vibe", winFiles).map((d) => d.code),
    ["TS2322", "TS5023", "TS18003"]
  )
  const parsed = parseOutput("/app/src/a.vibe\n/app/src/b.vibe\nsrc/b.vibe(1,1): error TS2322: bad b\n", "/app")
  assert.deepEqual(diagnosticsForFile(parsed.diagnostics, "/app/src/a.vibe", parsed.files), [])
  assert.deepEqual(diagnosticsForFile(parsed.diagnostics, "/app/src/b.vibe", parsed.files).map((d) => d.code), ["TS2322"])
})
