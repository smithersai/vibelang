// TS2307 on a stale relative ./a.ts (or ./a.tsx) whose module migrated to
// a.vibe (a.vibex): vibelang --fix rewrites the .vibe importer's specifier
// to the source name under rewriteRelativeImportExtensions, otherwise to the
// runtime .js (.jsx for a .vibex module under jsx preserve). The repaired
// project compiles clean and runs. Without a migrated sibling, or in a .ts
// importer the fix does not own, the import stays unresolved.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const forms = {
  value: s => `import { a } from "${s}"\nexport const b: number = a\n`,
  reexport: s => `export { a } from "${s}"\n`,
  type: s => `import type { A } from "${s}"\nexport const b: A = 1\n`,
  dynamic: s => `export const m = import("${s}")\n`,
}
const rewrite = { rewriteRelativeImportExtensions: true }
// [migrated file, importer, written, options, repaired spelling or null]
const rows = [
  ["a.vibe", "main.vibe", "./a.ts", {}, "./a.js"],
  ["a.vibe", "main.vibe", "./a.ts", rewrite, "./a.vibe"],
  ["a.vibex", "main.vibe", "./a.tsx", {}, "./a.js"],
  ["a.vibex", "main.vibe", "./a.tsx", { jsx: "preserve" }, "./a.jsx"],
  ["a.vibex", "main.vibe", "./a.tsx", { ...rewrite, jsx: "preserve" }, "./a.vibex"],
  ["a.vibex", "main.vibe", "./a.tsx", rewrite, "./a.vibex"],
  ["lib/a.vibe", "src/main.vibe", "../lib/a.ts", {}, "../lib/a.js"],
  ["lib/a.vibe", "src/main.vibe", "../lib/a.ts", rewrite, "../lib/a.vibe"],
  // No migrated sibling: b.vibe is not a's migration; a.vibe is not a.tsx's.
  ["b.vibe", "main.vibe", "./a.ts", {}, null],
  ["b.vibe", "main.vibe", "./a.ts", rewrite, null],
  ["a.vibe", "main.vibe", "./a.tsx", {}, null],
  // A native importer is not an owned VibeLang source.
  ["a.vibe", "main.ts", "./a.ts", {}, null],
  ["a.vibe", "main.ts", "./a.ts", rewrite, null],
]
let repaired = 0
for (const [file, importer, written, o, want] of rows) for (const [fname, form] of Object.entries(forms)) project(({ put, read, invoke, run }) => {
  const label = [file, importer, written, JSON.stringify(o), fname].join(" ")
  put(file, "export const a = 1\nexport type A = number\n")
  put(importer, form(written))
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), jsx: "react-jsx", jsxImportSource: "effect", rootDir: ".", ...o }, include: ["**/*.vibe", "**/*.vibex", "**/*.ts"], exclude: ["out"] })
  const before = invoke("-p", ".", "--pretty", "false")
  assert.deepEqual(diagnostics(before.text), ["error TS2307"], label + "\n" + before.text)
  const fix = invoke("--fix", "-p", ".", "--pretty", "false")
  if (want === null) {
    assert.equal(read(importer), form(written), label)
    assert.deepEqual(diagnostics(fix.text), ["error TS2307"], label + "\n" + fix.text)
    assert.notEqual(fix.status, 0)
    return
  }
  assert.equal(read(importer), form(want), label)
  assert.equal(fix.status, 0, label + "\n" + fix.text)
  const after = invoke("-p", ".", "--pretty", "false")
  assert.equal(after.status, 0, label + "\n" + after.text)
  assert.equal(after.text, "", label)
  // The repaired value import runs, except preserved JSX output.
  if (fname === "value" && o.jsx !== "preserve") {
    const out = "./out/" + importer.replace(/\.vibe$/, ".js")
    const r = run(process.execPath, ["--input-type=module", "-e", `console.log((await import(${JSON.stringify(out)})).b)`])
    assert.equal(r.stdout, "1\n", label + "\n" + r.text)
  }
  repaired++
})
assert.equal(repaired, 8 * 4)
console.log("--fix repairs stale .ts names to .vibe/.vibex under rewriteRelativeImportExtensions, else .js or .jsx")
