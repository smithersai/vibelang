// A dollar-prefixed name may be deliberately written to exercise hygiene.
// Judge a quoted name at the reported source location, rather than treating
// its spelling alone as proof that a rule saw compiler-generated code.
export function synthesizedNameAtNode(message, node) {
  const names = [...message.message.matchAll(/'(\$[\p{ID_Continue}$\u200C\u200D]*)'/gu)].map((match) => match[1])
  return names.some((name) => node?.type !== "Identifier" || node.name !== name || node.synthesized === true)
}

export function reportsSynthesizedName(message, sourceCode) {
  if (!/'\$[\p{ID_Continue}$\u200C\u200D]*'/u.test(message.message)) return false
  const index = sourceCode.getIndexFromLoc({ line: message.line, column: message.column - 1 })
  return synthesizedNameAtNode(message, sourceCode.getNodeByRangeIndex(index))
}
