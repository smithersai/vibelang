import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export function importMetaRelocationProblems(text, path = "guide") {
  const plain = text.replaceAll(String.fromCharCode(96), "").replace(/\s+/g, " ")
  return /Code that reads import\.meta\.filename or import\.meta\.dirname never moves/.test(plain)
    ? [{ path, rule: "import-meta-directory-identity" }] : []
}

export function checkImportMetaRelocationDocs(root = fileURLToPath(new URL("../..", import.meta.url))) {
  return ["docs/user/src/platform/105-introduction.md", "docs/user/src/platform/platform-globals.md"].flatMap(path =>
    importMetaRelocationProblems(readFileSync(resolve(root, path), "utf8"), path))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkImportMetaRelocationDocs(process.argv[2])
  for (const problem of problems) console.error(problem.path + ": distinguish the entry filename from its shared sibling directory")
  process.exitCode = problems.length ? 1 : 0
}
