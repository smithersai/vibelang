import assert from "node:assert/strict"

export const isCallRule = "linters, Knip, bundlers and test runners each read `.vibe`"

export function isInputs(fc) {
  return fc.record({
    subject: fc.constantFrom("next", "obj.read", "(next)"),
    subjectGap: fc.constantFrom("", " ", "\n", "/* line\n break */"),
    pattern: fc.constantFrom("if (true)", "Exit.Failure", "not Exit.Success", "0 or 1", "if (guard(flag))", "if (guard\n(flag))"),
    prefix: fc.constantFrom("", "// 😀\r\n", "/* é */\n", "\uFEFF\t")
  }).map(({ subject, subjectGap, pattern, prefix }) => ({
    code: prefix + "function f() {\n  return " + subject + subjectGap + "(0) is " + pattern + "\n}\nfunction after() {}\n",
    warnings: Number(/[\r\n]/u.test(subjectGap)) + Number(pattern.includes("guard\n"))
  }))
}

export function checkIsForm(tree) {
  const forms = []
  function visit(node) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) return node.forEach(visit)
    if (node.type === "VibeIsExpression") forms.push(node)
    for (const [key, value] of Object.entries(node)) if (!["tokens", "comments", "range", "loc", "parent"].includes(key)) visit(value)
  }
  visit(tree)
  assert.equal(forms.length, 1, "captured pattern has one source is form")
  assert.equal(forms[0].callee.type, "ArrowFunctionExpression", "matcher keeps its lexical scope")
  assert.equal(forms[0].arguments.length, 1, "subject is visited once")
}
