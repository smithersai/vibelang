import assert from "node:assert/strict"
import { main } from "knip"
import { createOptions } from "knip/session"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
const compiler = new URL("../knip.mjs", import.meta.url).href
const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
function declaration(input, extension) {
  const name = input.name, native = extension === "vibe" || extension === "vibex"
  switch (input.kind) {
    case "function": return "export function " + name + "() { return " + (extension.endsWith("x") ? "<div />" : "1") + " }\n"
    case "class": return "export class " + name + " {}\n"
    case "error": return native ? "export error " + name + " { message: string }\n" : "export class " + name + " { message?: string }\n"
    case "service": return native ? "export service " + name + " { value: number }\n" : "export const " + name + " = {value: 1}\n"
    default: return "export const " + name + " = 1\n"
  }
}
async function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "knip-default-alias-")), reports = []
  try {
    for (const extension of [input.extension === "vibex" ? "tsx" : "ts", input.extension]) {
      const cwd = join(root, extension); mkdirSync(cwd)
      writeFileSync(join(cwd, "package.json"), '{"name":"default-alias-probe","private":true,"type":"module"}')
      const doc = "/** @public */\n"
      const alias = input.parenthesized ? "(" + input.name + ")" : input.name
      writeFileSync(join(cwd, "lib." + extension),
        "// café\n" + (input.docs === "named" ? doc : "") + declaration(input, extension) +
        (input.docs === "default" ? doc : "") + "export default " + alias + "\nexport const unusedControl = 2\n")
      writeFileSync(join(cwd, "entry." + extension), input.access === "import"
        ? 'import value from "./lib.' + extension + '"; export const result = value\n'
        : 'import * as Tool from "./lib.' + extension + '"; export const result = ' + (input.access === "bracket" ? 'Tool["default"]' : "Tool.default") + "\n")
      writeFileSync(join(cwd, "knip.config.js"),
        "import compile from " + JSON.stringify(compiler) + "; export default " +
        JSON.stringify({ entry: ["entry." + extension], project: ["*." + extension] }).slice(0, -1) +
        ", compilers: {vibe:compile,vibex:compile}};\n")
      const options = await createOptions({ cwd, args: { "no-config-hints": true } }); options.isShowProgress = false
      const result = await main(options)
      assert.ok(result.counters.processed >= 2)
      const issues = type => Object.values(result.issues[type] ?? {}).flatMap(Object.values).filter(issue => issue.filePath === join(cwd, "lib." + extension))
      reports.push({
        exports: issues("exports").map(issue => issue.symbol).sort(),
        types: issues("types").map(issue => issue.symbol).sort(),
        duplicates: issues("duplicates").map(issue => issue.symbols.map(value => value.symbol).sort().join("|")).sort(),
      })
    }
    assert.deepEqual(reports[1], reports[0], "default aliases retain native duplicate and unused findings")
    assert.ok(reports[0].exports.includes("unusedControl"), "keep a genuine unused-export finding")
    if (input.kind === "const" && !input.parenthesized && input.docs === "none")
      assert.ok(reports[0].duplicates.includes([input.name, "default"].sort().join("|")), "the twin must report the planted duplicate")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("the default-alias oracle quotes the current specification", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})
test("Knip reports the named and default exports of one binding as duplicates", async () => {
  for (const extension of ["vibe", "vibex"])
    await verify({ extension, kind: "const", name: "Value", docs: "none", access: "dot", parenthesized: false })
})
test("default export aliases match TypeScript across declarations and source extensions", async () => {
  await checkProperty(fc, {
    name: "KnipDefaultExportAliases",
    rule: "Chapter7: " + quote + " Actual Knip analysis of a TypeScript twin determines duplicate and unused exports.",
    command: "node --test packages/compiler/test/knip-default-alias.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    numRuns: 48,
    arbitrary: fc.record({
      extension: fc.constantFrom("vibe", "vibex"), kind: fc.constantFrom("const", "function", "class", "error", "service"),
      name: fc.stringMatching(/^[A-Z][a-z]{1,7}$/), docs: fc.constantFrom("none", "named", "default"),
      access: fc.constantFrom("dot", "bracket", "import"), parenthesized: fc.boolean(),
    }),
    check: verify,
  })
})
