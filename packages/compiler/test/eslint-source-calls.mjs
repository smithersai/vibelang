import assert from "node:assert/strict"

export const sourceCallRule = "linters, Knip, bundlers and test runners each read `.vibe`"

export function callInputs(fc) {
  return fc.record({
    callee: fc.constantFrom("fn", "obj.method", "obj[key]", "(fn)", "factory()"),
    between: fc.constantFrom("", " ", "/* gap */", "\n", "\r\n", "/* line\n break */", "// gap\n", "\u2028"),
    prefix: fc.constantFrom("", "// 😀\r\n", "/* é */\n", "\uFEFF\t"),
    args: fc.array(fc.nat(100), { minLength: 1, maxLength: 4 }),
    extension: fc.constantFrom("vibe", "ts")
  }).map(({ callee, between, prefix, args, extension }) => ({
    code: prefix + "const result = " + callee + between + "(" + args.join(", ") + "); void result;",
    filePath: "/source-call." + extension,
    warnings: /[\r\n\u2028\u2029]/u.test(between) ? 1 : 0
  }))
}

function nodes(value) {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) return value.flatMap(nodes)
  return [...(value.type ? [value] : []), ...Object.entries(value)
    .filter(([key]) => !["tokens", "comments", "range", "loc", "parent"].includes(key))
    .flatMap(([, child]) => nodes(child))]
}

// Core no-unexpected-multiline reads the next non-closing-paren token after a
// callee. For an ordinary non-generic call that token must be its opening (.
export function checkCallBoundaries(ast, code) {
  const calls = nodes(ast).filter((node) => node.type === "CallExpression" && node.arguments.length && !node.optional)
  assert.ok(calls.length > 0, "the fixture must exercise a call with arguments")
  for (const call of calls) {
    const token = ast.tokens.find((token) => token.range[0] >= call.callee.range[1] && token.value !== ")")
    assert.equal(token?.value, "(", "call boundary after " + JSON.stringify({ type: call.callee.type, range: call.callee.range }) + "\n" + code)
  }
}

// Neighbours of the repaired defect still have the same source method call and
// continue target. Vary its receiver, arguments, trivia and source offsets.
export function doCallInputs(fc) {
  return fc.record({
    receiver: fc.constantFrom("out", "this", "factory()"),
    method: fc.constantFrom(".push", "[key]", ".bind"),
    parenthesized: fc.boolean(),
    args: fc.array(fc.nat(100), { minLength: 1, maxLength: 4 }),
    gap: fc.constantFrom("", " ", "/* gap */", "\n", "\r\n", "/* line\n break */", "\u2028"),
    prefix: fc.constantFrom("", "// 😀\r\n", "/* é */\n", "\uFEFF\t")
  }).map(({ receiver, method, parenthesized, args, gap, prefix }) => ({
    code: prefix + "function f() {\n  for (const i of [0, 1]) {\n    " + (parenthesized ? "(" + receiver + method + ")" : receiver + method) + gap +
      "(" + args.join(", ") + ", do { if (i === 0) continue; 0 })\n  }\n  return 0\n}\n",
    filePath: "/source-call.vibe",
    warnings: /[\r\n\u2028\u2029]/u.test(gap) ? 1 : 0
  }))
}
