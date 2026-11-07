// Output names follow the native twin (007-tooling.md, Formatting and
// existing tools): every jsx mode and declaration setting compiles a .vibe and
// .vibex project and its .ts/.tsx twin, and both write the same outDir.
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions, codes } from "../_tooling-witness.mjs"

const outputs = dir => readdirSync(join(dir, "out"), { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(join(dir, "out").length + 1)).sort()
const reactStub = {
  "node_modules/react/package.json": { name: "react", version: "19.0.0", exports: { "./jsx-runtime": { types: "./jsx-runtime.d.ts" }, "./jsx-dev-runtime": { types: "./jsx-dev-runtime.d.ts" } } },
  "node_modules/react/jsx-runtime.d.ts": "export declare function jsx(...a: any[]): any\nexport declare function jsxs(...a: any[]): any\nexport declare const Fragment: any\nexport declare namespace JSX { interface IntrinsicElements { [k: string]: any } type Element = any }\n",
  "node_modules/react/jsx-dev-runtime.d.ts": "export declare function jsxDEV(...a: any[]): any\nexport declare const Fragment: any\nexport declare namespace JSX { interface IntrinsicElements { [k: string]: any } type Element = any }\n",
}
const globalJsx = "declare namespace JSX { type Element = any; interface IntrinsicElements { [tag: string]: any } }\n"
const view = "function h(...a: any[]): any { return a }\nexport const view = <p>{h}</p>\n"
const compile = (twin, jsx, declaration) => project(({ dir, put, invoke, stock }) => {
  const [code, markup] = twin ? ["ts", "tsx"] : ["vibe", "vibex"]
  for (const [file, text] of Object.entries(reactStub)) put(file, text)
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), rootDir: ".", jsx, ...(jsx === "react" ? { jsxFactory: "h" } : {}), declaration, rewriteRelativeImportExtensions: true },
    include: ["**/*." + code, "**/*." + markup, "jsx.d.ts"], exclude: ["node_modules", "out"] })
  put("jsx.d.ts", globalJsx)
  put(`x.${code}`, `import { view } from "./y.${markup}"\nexport const all = [view, 1]\n`)
  put(`y.${markup}`, view)
  put(`nested/deep/z.${code}`, "export const z = 1\n")
  put(`nested/w.${markup}`, view)
  const r = (twin ? stock : invoke)("-p", ".", "--pretty", "false")
  assert.deepEqual(codes(r.text), [], r.text)
  return outputs(dir)
})

const want = (jsx, declaration) => ["x.js", jsx === "preserve" ? "y.jsx" : "y.js", "nested/deep/z.js", jsx === "preserve" ? "nested/w.jsx" : "nested/w.js"]
  .flatMap(js => declaration ? [js, js.replace(/\.jsx?$/, ".d.ts")] : [js]).sort()
let rows = 0
for (const jsx of ["preserve", "react", "react-jsx", "react-jsxdev", "react-native"]) {
  for (const declaration of [true, false]) {
    const vibe = compile(false, jsx, declaration)
    assert.deepEqual(vibe, compile(true, jsx, declaration), `${jsx} declaration=${declaration}: the twin's names`)
    assert.deepEqual(vibe, want(jsx, declaration), `${jsx} declaration=${declaration}`)
    rows++
  }
}
assert.equal(rows, 10)
console.log("x.vibe emits x.js and x.d.ts; x.vibex emits x.jsx only under preserve, as the native twin")
