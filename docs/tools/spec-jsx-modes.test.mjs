import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Loop round 4, OPUS-3: VIP-39's "try inside JSX" bullet sorts the jsx modes
// into those TypeScript transforms and those that keep the element in the
// output for a framework's compiler. TypeScript decides which is which, so the
// test emits one element under every JsxEmit value and compares.
const vip = read("docs/design/vips/0039-vibex.md")
const bullet = vip.split("\n").find(l => l.startsWith("- **`try` inside JSX is legal and lowers in place.**"))

const names = { [ts.JsxEmit.Preserve]: "preserve", [ts.JsxEmit.React]: "react", [ts.JsxEmit.ReactNative]: "react-native", [ts.JsxEmit.ReactJSX]: "react-jsx", [ts.JsxEmit.ReactJSXDev]: "react-jsxdev" }

function modes(sentence) {
  return [...sentence.matchAll(/`([a-z-]+)`/g)].map(m => m[1]).filter(m => Object.values(names).includes(m)).sort()
}

function emitted(mode) {
  const out = ts.transpileModule("declare const x: number\nexport const v = <div>{x}</div>\n", { fileName: "x.tsx", compilerOptions: { jsx: mode, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } })
  return out.outputText
}

test("the modes VIP-39 says keep the element are the ones TypeScript leaves JSX in", () => {
  assert.ok(bullet, "VIP-39 lost its try-inside-JSX bullet")
  const transformSentence = bullet.slice(bullet.indexOf("Under "), bullet.indexOf("TypeScript transforms the element"))
  const keepSentence = bullet.slice(bullet.indexOf("Under ", bullet.indexOf("TypeScript transforms the element")), bullet.indexOf("which keep the element in the output"))
  const kept = [], transformed = []
  for (const value of Object.values(ts.JsxEmit).filter(v => typeof v === "number" && v !== ts.JsxEmit.None)) {
    assert.ok(names[value], `TypeScript has a jsx mode VIP-39 does not name: ${ts.JsxEmit[value]}`)
    ;(emitted(value).includes("<div>") ? kept : transformed).push(names[value])
  }
  assert.deepEqual(modes(keepSentence), kept.sort())
  assert.deepEqual(modes(transformSentence), transformed.sort())
})

test("VIP-39's output rule writes .jsx under preserve alone", () => {
  assert.ok(vip.includes("`x.vibex` emits `x.jsx` under `\"jsx\": \"preserve\"` and `x.js` otherwise (`react-native` keeps JSX in `x.js`)"))
  const program = (mode) => {
    const host = ts.createCompilerHost({})
    const written = []
    host.writeFile = (name) => written.push(name.split("/").pop())
    host.getSourceFile = (name, target) => name === "/x.tsx" ? ts.createSourceFile(name, "export const v = <div/>\n", target, true, ts.ScriptKind.TSX) : undefined
    host.fileExists = (name) => name === "/x.tsx"
    host.readFile = () => undefined
    ts.createProgram(["/x.tsx"], { jsx: mode, outDir: "/out", noLib: true, types: [] }, host).emit()
    return written
  }
  assert.deepEqual(program(ts.JsxEmit.Preserve), ["x.jsx"])
  for (const mode of [ts.JsxEmit.React, ts.JsxEmit.ReactNative, ts.JsxEmit.ReactJSX, ts.JsxEmit.ReactJSXDev]) assert.deepEqual(program(mode), ["x.js"], names[mode])
})
