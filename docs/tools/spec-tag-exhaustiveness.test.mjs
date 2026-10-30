import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { defaultCompiler } from "./check-snippets"
import { block, chapter, read, tools } from "./spec-witness.mjs"

const compiler = defaultCompiler()

// Each @ts-expect-error in the block is a claim about tsc: if TypeScript stops
// reporting that member as left, the rule's precedent moved.
test("tsc --strict leaves exactly the members the rule says", { skip: !existsSync(compiler) }, () => {
  const source = block(chapter("004-match"), "type Optional =")
  const directory = mkdtempSync(join(tools, ".spec-tags-"))
  try {
    writeFileSync(join(directory, "tags.ts"), source + "\nexport {}\n")
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], noEmit: true },
      include: ["tags.ts"]
    }))
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: directory, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the rule cites what TypeScript's checker does", () => {
  const flow = read("typescript/tsc/internal/checker/flow.go")
  assert.match(flow, /func \(c \*Checker\) computeExhaustiveSwitchStatement[\s\S]*?if !isLiteralType\(t\) \{\n\t\treturn false/)
  assert.match(flow, /func \(c \*Checker\) isTypePresencePossible[\s\S]*?SymbolFlagsOptional/)
})

test("one definition of a tagged member", () => {
  const match = chapter("004-match")
  assert.equal([...match.matchAll(/id="tagged-members"/g)].length, 1)
  assert.match(chapter("006-data"), /004-match\.md#tagged-members/)
  for (const name of ["004-match", "006-data"]) assert.doesNotMatch(chapter(name), /exactly one string literal/)
})
