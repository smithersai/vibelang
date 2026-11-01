import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Loop round 4, OPUS-1 (decided detail 250, with VIP-39's rejected
// "JSX elements as throw-tracked calls"): TypeScript compares an attribute's
// value with the prop's type and a tag with JSX.ElementType, so VIP-39 must
// say which of the two is a VIP-4 assignability site. It says: the attribute.
const vip = read("docs/design/vips/0039-vibex.md")
const jsx = `declare namespace JSX {
  type Element = { readonly element: true }
  type ElementType = string | ((props: any) => Element)
  interface IntrinsicElements { button: { onClick?: () => void } }
}
`

function diagnostics(source) {
  const files = { "/x.tsx": jsx + source }
  const host = ts.createCompilerHost({})
  host.getSourceFile = (name, target) => name in files ? ts.createSourceFile(name, files[name], target, true, ts.ScriptKind.TSX) : undefined
  host.fileExists = (name) => name in files
  host.readFile = (name) => files[name]
  const program = ts.createProgram(["/x.tsx"], { jsx: ts.JsxEmit.Preserve, noLib: true, types: [], strict: true }, host)
  return program.getSemanticDiagnostics().map(d => d.code)
}

test("TypeScript compares both an attribute and a tag with a call signature", () => {
  assert.deepEqual(diagnostics("const ok = <button onClick={() => {}} />\n"), [])
  // The attribute: a member-by-member comparison with the prop's function type.
  assert.deepEqual(diagnostics("const bad = <button onClick={(n: number) => {}} />\n"), [2322])
  // The tag: a comparison of the component's signature with JSX.ElementType.
  assert.deepEqual(diagnostics("function Num(props: {}) { return 1 }\nconst bad = <Num />\n"), [2786])
})

test("VIP-39 makes the attribute a VIP-4 assignability site and the tag not one", () => {
  const bullet = vip.split("\n").find(l => l.startsWith("- **An attribute is an object member under VIP-4.**"))
  assert.ok(bullet, "VIP-39 lost its attribute bullet")
  assert.ok(bullet.includes("a function value in an attribute must fit the prop's call signature, as in `f({ onClick: … })` ([Assignability](../src/003-failures.md#assignability))"))
  assert.ok(bullet.includes("is `EK0402` against an untagged `onClick`, in `onClick={handler}` and in a spread `{...{ onClick: handler }}` alike"))
  assert.ok(bullet.includes("The check of a tag against `JSX.ElementType` or `JSX.ElementClass` is not an assignability site"))
  // The rejected row the tag sentence rests on, and the chapter rule it applies.
  assert.ok(vip.includes("| JSX elements as throw-tracked calls of the factory | Sol |"))
  assert.match(read("docs/design/src/003-failures.md"), /The rule applies wherever TypeScript checks one call signature against another: assignments, arguments, returns against a written return type, object members/)
})
