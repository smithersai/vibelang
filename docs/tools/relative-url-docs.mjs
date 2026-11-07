import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A raw nonempty URL reference can become empty, query-only or fragment-only
// after parsing removes initial controls and spaces. Keep that caveat beside
// claims that moving a relative reference preserves its base file.
export function relativeUrlDocProblems(text, path = "guide") {
  return text.replaceAll(String.fromCharCode(96), "").split(/\n\s*\n/).flatMap(paragraph => {
    const plain = paragraph.replace(/\s+/g, " ")
    const broad = /new\s+URL\s*\(/.test(plain) && /not empty/.test(plain) && /starts with neither/.test(plain)
    const qualified = /leading (?:whitespace|control)|C0 control/.test(plain)
    return broad && !qualified ? [{ path, rule: "relative-url-leading-whitespace" }] : []
  })
}

export function checkRelativeUrlDocs(root = fileURLToPath(new URL("../..", import.meta.url))) {
  return [".smithers/flows/migrate/README.md", "docs/user/src/setup/release-notes.md"].flatMap(path =>
    relativeUrlDocProblems(readFileSync(resolve(root, path), "utf8"), path))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRelativeUrlDocs(process.argv[2])
  for (const problem of problems) console.error(problem.path + ": qualify raw relative-URL paths with their leading-whitespace limit")
  process.exitCode = problems.length ? 1 : 0
}
