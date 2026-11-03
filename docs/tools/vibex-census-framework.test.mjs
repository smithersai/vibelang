// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#8a8bcb445ccf7ecc
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#73894844cf30b608
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#c92f3ba136dad3cf
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#81fb726540709ae8
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#e29538b5962654bf
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#ccb3a873558cc123
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#abe592b36d0e393c
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#a0b06a37f46520d5
// VIP-39 framework boundary: docs/design/vips/0039-vibex.md#ac3bf2bb70a74110
import assert from "node:assert/strict"
import { test } from "node:test"
import { babel, solid, reactTransform, createElement, createComponent, ts } from "./test/vibex-frameworks/load.mjs"

const transform = (source, preset) => babel.transformSync(source, {
  configFile: false, babelrc: false,
  ...(preset === "solid" ? {presets: [[solid, {generate: "dom"}]]} : {plugins: [reactTransform]})
}).code

const witnesses = [
  ["child", "function* view() { return <div>{yield* work}</div> }", false],
  ["attribute", "function* view() { return <div title={yield* work}/> }", false],
  ["await", "async function view() { return <div>{await work}</div> }", false],
  ["component", "function* view() { return <Comp v={yield* work}/> }", true],
  ["bound", "function* view() { const value = yield* work; return <div>{value}</div> }", true]
]
for (const [name, source, valid] of witnesses) test("VIP-39 Solid " + name, () => {
  const jsx = ts.transpileModule(source, {fileName:"main.tsx", compilerOptions:{target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.Preserve}}).outputText
  const output = transform(jsx, "solid")
  if (valid) assert.doesNotThrow(() => babel.parseSync(output, {configFile:false,babelrc:false}))
  else assert.throws(() => babel.parseSync(output, {configFile:false,babelrc:false}), /yield|await|reserved|Unexpected/)
})

test("VIP-39 Babel React rejects namespaces downstream, while TSX parses them", () => {
  const source = "const element = <a:b c:d='1'/>"
  const file = ts.createSourceFile("main.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.deepEqual(file.parseDiagnostics, [])
  assert.throws(() => transform(source, "react"), /Namespace tags|namespace/)
})

test("VIP-39 JSX factories retain their framework's component-call behavior", () => {
  let calls = 0
  const Component = () => { calls++; return "value" }
  const element = createElement(Component, {})
  assert.equal(calls, 0)
  assert.equal(element.type, Component)
  assert.equal(createComponent(Component, {}), "value")
  assert.equal(calls, 1)
})
