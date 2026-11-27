import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"

const repo = new URL("../../../", import.meta.url)
const preludeText = readFileSync(new URL("packages/ts-mapper/prelude.d.ts", repo), "utf8")
const ts = createRequire(new URL("docs/tools/package.json", repo))("typescript")

test("prelude.d.ts parses cleanly with TypeScript without syntax diagnostics", () => {
  const sf = ts.createSourceFile("prelude.d.ts", preludeText, ts.ScriptTarget.ESNext, true)
  const diagnostics = sf.parseDiagnostics ?? []
  assert.equal(diagnostics.length, 0, `unexpected syntax diagnostics in prelude.d.ts: ${diagnostics.length}`)
  assert.ok(sf.statements.length > 20, "prelude.d.ts must declare substantial Effect and runtime exports")
})

test("prelude.d.ts declares esnext.disposable reference and $PreludeLoaded sentinel", () => {
  const head = preludeText.split("\n").slice(0, 15).join("\n")
  assert.ok(head.includes("esnext.disposable"), "prelude.d.ts should reference esnext.disposable")
  assert.ok(preludeText.includes("$PreludeLoaded"), "prelude.d.ts must declare $PreludeLoaded sentinel")
})
