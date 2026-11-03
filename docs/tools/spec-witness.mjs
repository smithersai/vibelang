// A rule's printed counterpart is a test: read a chapter, take the `ts effect`
// block that holds a marker, and run it where `effect` resolves.
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const tools = dirname(fileURLToPath(import.meta.url))
export const repo = resolve(tools, "../..")

export const read = (path) => readFileSync(join(repo, path), "utf8")
export const chapter = (name) => read(`docs/design/src/${name}.md`)

// Main's chapter 3 states Will's no-throw rule. Lane fold-details folds the rest of nothrow-impl's spec text
// (fold-inputs/nothrow-impl.patch): the introduction's principle 4 stops listing `throw` among TypeScript's meanings,
// and chapter 3 names rest positions and `do` expressions. Until then a test of that text stays pending, and it
// runs again by itself once the text lands.
export const nothrowFoldPending = chapter("000-intro").includes("Plain functions, `async` functions, `await`, `throw`, `using`")
  ? "pending fold-details: nothrow-impl.patch (principle 4, rest positions, do expressions) has not landed"
  : false

export function block(text, marker, language = "ts effect") {
  const found = [...text.matchAll(/```([a-z]+(?: [a-z]+)?)\n([\s\S]*?)```/g)]
    .filter(m => m[1] === language && m[2].includes(marker))
  if (found.length !== 1) throw new Error(`${found.length} ${language} blocks hold ${marker}`)
  return found[0][2]
}

export function run(source) {
  const directory = mkdtempSync(join(tools, ".spec-witness-"))
  try {
    const file = join(directory, "witness.ts")
    writeFileSync(file, source)
    return spawnSync("bun", ["run", file], { cwd: tools, encoding: "utf8" })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
