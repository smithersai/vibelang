import assert from "node:assert/strict"

export const concurrentToolRule = "linters, Knip, bundlers and test runners read `.vibe`"

export function concurrentInputs(fc) {
  return fc.record({
    forGap: fc.constantFrom(" ", "\n", "/* line\n break */"),
    gap: fc.constantFrom("", " ", "\r\n", "/* comment\n */"),
    headGap: fc.constantFrom("", "\n", " /* head */ "),
    concurrency: fc.constantFrom(null, "2", "limit(1)", "limit\n(1)"),
    iterable: fc.constantFrom("[1, 2]", "items(1)", "items\n(1)"),
    bodyGap: fc.constantFrom("", "\n"),
    binding: fc.constantFrom("const x", "let x", "const {value: x}", "const [x]"),
    prefix: fc.constantFrom("", "// 😀\r\n", "/* é */\n", "\uFEFF\t")
  }).map(({ forGap, gap, headGap, concurrency, iterable, bodyGap, binding, prefix }) => ({
    code: prefix + "effect function f() {\n  for" + forGap + "concurrent" + gap +
      (concurrency === null ? "" : "(" + concurrency + ")") + headGap +
      "(" + binding + " of " + iterable + ") { use" + bodyGap + "(x) }\n}\n",
    bounded: concurrency !== null,
    warnings: Number(concurrency?.includes("\n") ?? false) + Number(iterable.includes("\n")) + Number(bodyGap.includes("\n"))
  }))
}

export function checkConcurrentForm(tree, bounded) {
  const forms = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(visit)
    if (node.type === "VibeForConcurrentStatement") forms.push(node)
    for (const [key, value] of Object.entries(node)) if (!["tokens", "comments", "range", "loc", "parent"].includes(key)) visit(value)
  }
  visit(tree)
  assert.equal(forms.length, 1, "one source concurrent statement")
  assert.ok(Object.hasOwn(forms[0], "concurrency"))
  assert.equal(forms[0].concurrency !== null, bounded, "only a written limit has a node")
  assert.equal(forms[0].body.type, "ArrowFunctionExpression", "item binding retains its scope")
  assert.equal(forms[0].body.params.length, 1)
  assert.ok(forms[0].iterable, "source iterable is visited")
}
