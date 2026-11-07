// rule-evidence: docs/design/src/007-tooling.md#formatting-and-existing-tools | Output names follow the native twin: `x.vibe` emits `x.js` and `x.d.ts` in `outDir`; `x.vibex` emits `x.jsx` under `"jsx": "preserve"`, otherwise `x.js`, with `x.d.ts` when declarations are enabled.
// Chapter 7: .vibex output names under JSX preserve and declaration output.
// Stable rule id: docs/design/src/007-tooling.md#654575a33d8e24a4
// Each probe compiles x.vibe, y.vibex and their native twins xt.ts and yt.tsx
// in one project, and the VibeLang outputs have the twins' names.
// run-seconds: 300
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project, check } from "../../tests/coverage-tooling.mjs"

const sources = {
  "src/x.vibe": "export const x: number = 1\n",
  "src/y.vibex": "export const y = (n: number) => n + 1\n",
  "src/xt.ts": "export const x: number = 1\n",
  "src/yt.tsx": "export const y = (n: number) => n + 1\n",
}
const listing = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map(String).sort() : []
for (const jsx of ["preserve", "react-jsx", "react"]) for (const declaration of [true, false]) {
  const key = jsx + "-" + (declaration ? "declarations" : "no-declarations")
  const p = project(import.meta.url, key, sources, { compilerOptions: { noEmit: false, jsx, declaration, outDir: "build", rootDir: "src" } })
  const r = check(p)
  assert.equal(r.status, 0, key + ": " + r.output)
  const files = listing(path.join(p.dir, "build"))
  const js = jsx === "preserve" ? ".jsx" : ".js"
  const want = ["x.js", "xt.js", "y" + js, "yt" + js, ...(declaration ? ["x.d.ts", "xt.d.ts", "y.d.ts", "yt.d.ts"] : [])].sort()
  assert.deepEqual(files, want, key)
  console.log(key + ": " + files.join(" "))
}
