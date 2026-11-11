import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { sidecarChanges } from "../lib/declarations.mjs"
const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")

export const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

export const forms = [
  (s) => `import type { B } from "${s}";\nexport declare const a: B;\n`,
  (s) => `import { type B } from '${s}';\nexport declare const a: B;\n`,
  (s) => `export declare const a: import("${s}").B;\n`,
  (s) => `export type { B } from "${s}";\nexport declare const a: number;\n`,
  (s) => `// see "./b.vibe"\nimport type { B } from "${s}";\nexport declare const a: B;\n`
]

export function checkInDirectory(outDir, s, write, change) {
const sidecar = write(s)
put(outDir, "a.d.ts", write("./b.js") + (change ? "export declare const added: string;\n" : ""))
const result = sidecarChanges(ts, { "src/a.d.vibe.ts": sidecar, "src/b.d.vibe.ts": "export type B = number;\n" }, outDir)
assert.equal(result.comparisonComplete, undefined, `${sidecar}\n${JSON.stringify(result.environmentDiagnostics)}`)
assert.deepEqual(result.changed.map((c) => c.file), change ? ["src/a.d.vibe.ts"] : [], sidecar)
}

export function check(s, write, change) {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-sidecar-vibe-import-property-"))
  try {
    put(outDir, "b.d.ts", "export type B = number;\n")
    return checkInDirectory(outDir, s, write, change)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
}
export function encode([s, write, change]) {
  const index = forms.indexOf(write)
  assert.notEqual(index, -1)
  return [s, index, change]
}
export function checkEncoded(s, index, change) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < forms.length)
  return check(s, forms[index], change)
}
