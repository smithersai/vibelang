import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const constructorRule = "Decoding invokes the override."
export const documentationPaths = [
  "docs/design/src/900-appendices.md",
  "docs/design/src/007-tooling.md",
  "docs/user/src/getting-started/012-devtools.md"
]

export function checkConstructorDocs(documents) {
  const problems = []
  for (const path of documentationPaths) {
    const text = documents.get(path) ?? ""
    const context = path.endsWith("900-appendices.md")
      ? text.split("\n").filter(line => /^\| interim `EK4814` \|/.test(line))
      : text.split(/\n\s*\n/).filter(paragraph => paragraph.includes("`EK4814`") && paragraph.includes(constructorRule))
    if (context.length !== 1 || !context[0].includes(constructorRule))
      problems.push(path + ": EK4814 must explain that decoding invokes the Schema constructor override.")
    if (/decoding (?:does not|doesn't|never) (?:invoke|call)|decoding builds instances without calling/i.test(text))
      problems.push(path + ": stale Schema constructor decoding claim.")
  }
  return problems
}

export function check(root) {
  return checkConstructorDocs(new Map(documentationPaths.map(path => [path, readFileSync(join(root, path), "utf8")])))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const problem of check(fileURLToPath(new URL("../../", import.meta.url)))) {
    console.error(problem)
    process.exitCode = 1
  }
}
