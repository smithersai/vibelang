// Adapt native lint directives in parsed comments, leaving source text, strings,
// node identity and locations intact. Oxlint accepts ESLint directives too.
export function withOxlintComments(parser, aliases) {
  return {
    ...parser,
    parseForESLint(...args) {
      const result = typeof parser.parseForESLint === "function"
        ? parser.parseForESLint(...args)
        : { ast: parser.parse(...args) }
      const reverse = new Map([...aliases].map(([actual, native]) => [native, actual]))
      const rule = name => reverse.get(name) ?? reverse.get("eslint/" + name)
        ?? (name.startsWith("eslint/") ? name.slice(7)
          : name.startsWith("typescript/") ? "@typescript-eslint/" + name.slice(11) : name)
      for (const comment of result.ast.comments ?? []) {
        const match = /^(\s*)(?:oxlint|eslint)-(disable(?:-next-line|-line)?|enable)\b([\s\S]*)$/.exec(comment.value)
        if (!match) continue
        const tail = match[3]
        const reasonAt = /\s+--(?:\s|$)/.exec(tail)?.index ?? tail.length
        const names = tail.slice(0, reasonAt).trim()
        // Oxlint 1.60 does not treat a reason-only body as a blanket
        // directive. Avoid broadening it into ESLint's blanket suppression.
        if (!names && reasonAt < tail.length) {
          comment.value = match[1] + "oxlint-" + match[2] + tail
          continue
        }
        const mapped = names ? " " + names.split(",").map(name => rule(name.trim())).join(", ") : ""
        comment.value = match[1] + "eslint-" + match[2] + mapped + tail.slice(reasonAt)
      }
      return result
    }
  }
}
