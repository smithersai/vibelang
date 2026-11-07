// JavaScript source-extension rewriting requires
// rewriteRelativeImportExtensions (007-tooling.md, Formatting and existing
// tools). A .vibe module and its .ts twin write the same imports, with and
// without the flag, under JSX-preserving and JSX-transforming output; both
// must report the same codes and emit the same specifiers, with a retained
// .ts/.tsx standing for .vibe/.vibex.
import assert from "node:assert/strict"
import { project, baseOptions, codes } from "../_tooling-witness.mjs"

const forms = (code, markup) => [
  `import { z } from "./z.${code}"`,
  `export { z as again } from "./z.${code}"`,
  `import "./side.${code}"`,
  `import { view } from "./y.${markup}"`,
  `import { z as js } from "./z.js"`,
  `export const load = () => import("./z.${code}")`,
  "export const all = [z, view, js]",
].join("\n") + "\n"
const native = text => text.replaceAll(".vibex\"", ".tsx\"").replaceAll(".vibe\"", ".ts\"")
const emit = (twin, jsx, rewrite) => project(({ put, read, invoke, stock }) => {
  const [code, markup] = twin ? ["ts", "tsx"] : ["vibe", "vibex"]
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), jsx, ...(jsx === "react" ? { jsxFactory: "h" } : {}), rewriteRelativeImportExtensions: rewrite },
    include: ["*." + code, "*." + markup, "jsx.d.ts"] })
  put("jsx.d.ts", "declare namespace JSX { type Element = any; interface IntrinsicElements { [tag: string]: any } }\n")
  put(`x.${code}`, forms(code, markup))
  put(`z.${code}`, "export const z = 1\n")
  put(`side.${code}`, "export {}\n")
  put(`y.${markup}`, "function h(...a: any[]): any { return a }\nexport const view = <p>{h}</p>\n")
  const r = (twin ? stock : invoke)("-p", ".", "--pretty", "false")
  return { codes: codes(r.text).sort(), specifiers: native(read("out/x.js")).match(/"\.\/[^"]*"/g) }
})

for (const jsx of ["preserve", "react"]) {
  for (const rewrite of [true, false]) {
    const vibe = emit(false, jsx, rewrite), twin = emit(true, jsx, rewrite)
    // The native twin rewrites every relative source extension only with the flag.
    assert.equal(twin.specifiers.some(s => /\.tsx?"$/.test(s)), !rewrite, `${jsx} rewrite=${rewrite}: twin`)
    assert.deepEqual(vibe, twin, `${jsx} rewrite=${rewrite}`)
  }
}
console.log("source-extension rewriting follows rewriteRelativeImportExtensions, as the native twin")
