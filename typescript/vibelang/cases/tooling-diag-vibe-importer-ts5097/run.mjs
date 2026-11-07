// Written ./x.vibe and ./x.vibex imports follow the .ts/.tsx twin's
// source-extension checks: across import, export, dynamic and type-only
// forms and the four option combinations, a .vibe importer reports exactly
// what stock TypeScript reports for its .ts twin importing ./x.ts and
// ./x.tsx, including TS5097 for value imports without
// allowImportingTsExtensions or rewriteRelativeImportExtensions.
// (tooling-diag-source-extension-checks covers .ts importers.)
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const importerExt = ".vibe"
const twin = s => s.replace(/\.vibex\b/g, ".tsx").replace(/\.vibe\b/g, ".ts")
const forms = {
  value: s => `import { x } from "${s}"\nexport const y = x\n`,
  type: s => `import type { X } from "${s}"\nexport const y: X = 1\n`,
  inlineType: s => `import { type X } from "${s}"\nexport const y: X = 1\n`,
  reexport: s => `export { x } from "${s}"\n`,
  typeReexport: s => `export type { X } from "${s}"\n`,
  star: s => `export * from "${s}"\n`,
  dynamic: s => `export const m = import("${s}")\n`,
  importType: s => `export type T = typeof import("${s}")\n`,
}
const optionSets = {
  none: {}, allow: { allowImportingTsExtensions: true, noEmit: true }, allowEmit: { allowImportingTsExtensions: true },
  rewrite: { rewriteRelativeImportExtensions: true },
}
// Each diagnostic as "file(line,col) code", the file renamed to its twin.
const listed = text => [...text.matchAll(/^(?:(\S+?)\((\d+),(\d+)\): )?error (TS\d+)/gm)].map(m => (m[1] ? twin(m[1]).replace(/^(v|s)\//, "") + "(" + m[2] + "," + m[3] + ") " : "") + m[4]).sort()
const lib = "export const x = 1\nexport type X = number\n"
let ts5097 = 0
for (const [name, o] of Object.entries(optionSets)) project(({ put, invoke, stock }) => {
  const compilerOptions = { ...baseOptions(), jsx: "preserve", ...o }
  const vfiles = [], sfiles = []
  for (const ext of [".vibe", ".vibex"]) {
    put("v/x" + ext, lib)
    put("s/x" + twin(ext), lib)
    for (const [fname, form] of Object.entries(forms)) {
      const file = fname + "_" + ext.slice(1) + importerExt
      put("v/" + file, form("./x" + ext))
      put("s/" + twin(file), twin(form("./x" + ext)))
      vfiles.push(file)
      sfiles.push(twin(file))
    }
  }
  put("v/tsconfig.json", { compilerOptions, files: vfiles })
  put("s/tsconfig.json", { compilerOptions, files: sfiles })
  const v = listed(invoke("-p", "v", "--pretty", "false").text)
  const s = listed(stock("-p", "s", "--pretty", "false").text)
  assert.deepEqual(v, s, name)
  if (name === "none") {
    // Every value form, and only those, is TS5097 in the twin.
    assert.deepEqual(s.filter(d => d.endsWith("TS5097")).map(d => d.split("_")[0]).sort(), ["dynamic", "dynamic", "inlineType", "inlineType", "reexport", "reexport", "star", "star", "value", "value"])
    ts5097 += v.filter(d => d.endsWith("TS5097")).length
  }
})
assert.equal(ts5097, 10)
console.log(".vibe importers of ./x.vibe and ./x.vibex get the .ts twin's source-extension diagnostics")
