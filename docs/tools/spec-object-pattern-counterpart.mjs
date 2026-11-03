import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

// VIP-7 / chapter 004: "functions are objects too".
// Run the printed counterpart itself; checking prose alone misses bad examples.
export function counterpart(text, name = "ids") {
  for (const block of text.matchAll(/^\x60\x60\x60ts effect\n([^]*?)^\x60\x60\x60/gm)) {
    const source = ts.createSourceFile("counterpart.ts", block[1], ts.ScriptTarget.Latest, true)
    const fn = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
    if (!fn) continue
    const js = ts.transpileModule(fn.getText(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText
    return { run: new Function(js + "\nreturn " + name)(), line: text.slice(0, block.index).split("\n").length }
  }
  throw new Error("missing executable object-pattern counterpart: " + name)
}

export function lintObjectPatternCounterpart(text) {
  const { run, line } = counterpart(text)
  const violations = []
  for (const [label, subject] of [
    ["function", () => 0],
    ["async function", async () => 0],
    ["generator", function* () {}],
    ["class", class Subject {}],
    ["bound function", (() => 0).bind(null)],
    ["object", {}],
    ["null-prototype object", Object.create(null)]
  ]) {
    Object.defineProperty(subject, "id", { value: 7 })
    const actual = run([subject])
    if (JSON.stringify(actual) !== "[7]") {
      violations.push({ line, message: "object-pattern counterpart drops " + label + " with id: expected [7], got " + JSON.stringify(actual) })
    }
  }
  return violations
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? fileURLToPath(new URL("../design/src/004-match.md", import.meta.url))
  const violations = lintObjectPatternCounterpart(readFileSync(path, "utf8"))
  for (const v of violations) console.error(path + ":" + v.line + ": " + v.message)
  process.exitCode = violations.length ? 1 : 0
}
