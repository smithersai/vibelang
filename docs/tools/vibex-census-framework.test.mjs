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
for (const [name, source, valid] of witnesses) test("Framework control: Solid " + name, () => {
  const jsx = ts.transpileModule(source, {fileName:"main.tsx", compilerOptions:{target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.Preserve}}).outputText
  const output = transform(jsx, "solid")
  if (valid) assert.doesNotThrow(() => babel.parseSync(output, {configFile:false,babelrc:false}))
  else assert.throws(() => babel.parseSync(output, {configFile:false,babelrc:false}), /yield|await|reserved|Unexpected/)
})

test("Framework control: Babel React rejects namespaces downstream, while TSX parses them", () => {
  const source = "const element = <a:b c:d='1'/>"
  const file = ts.createSourceFile("main.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.deepEqual(file.parseDiagnostics, [])
  assert.throws(() => transform(source, "react"), /Namespace tags|namespace/)
})

test("Framework control: JSX factories retain their framework's component-call behavior", () => {
  let calls = 0
  const Component = () => { calls++; return "value" }
  const element = createElement(Component, {})
  assert.equal(calls, 0)
  assert.equal(element.type, Component)
  assert.equal(createComponent(Component, {}), "value")
  assert.equal(calls, 1)
})
