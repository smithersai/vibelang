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

const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const compiler = new URL("../knip.mjs", import.meta.url).href

function expression({ form, namespace, member }) {
  switch (form) {
    case "dot": return namespace + "." + member
    case "single": return namespace + "['" + member + "']"
    case "double": return namespace + "[" + JSON.stringify(member) + "]"
    case "escaped": return namespace + '["\\u' + member.charCodeAt(0).toString(16).padStart(4, "0") + member.slice(1) + '"]'
    case "template": return namespace + "[`" + member + "`]"
    case "optional": return namespace + "?.[" + JSON.stringify(member) + "]"
    case "dynamic": return namespace + "[key]"
    default: throw new Error(form)
  }
}

// Actual Knip analysis of a TypeScript twin is the oracle, including its
// conservative treatment of unknown computed keys and its unused-export control.
async function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-knip-namespace-"))
  const reports = []
  try {
    for (const extension of [input.extension === "vibex" ? "tsx" : "ts", input.extension]) {
      const cwd = join(root, extension)
      mkdirSync(cwd)
      writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "namespace-probe", private: true, type: "module" }))
      writeFileSync(join(cwd, "lib." + extension), "export const " + input.member + " = 1;\nexport const unusedControl = 2;\n")
      const use = expression(input)
      writeFileSync(join(cwd, "entry." + extension),
        (input.leading ?? "") + "import * as " + input.namespace + ' from "./lib.' + extension + '";\n' +
        (input.form === "dynamic" ? 'declare const key: string;\n' : "") +
        "export const result = " + (extension.endsWith("x") ? "<div>{" + use + "}</div>" : use) + ";\n")
      writeFileSync(join(cwd, "knip.config.js"),
        "import compile from " + JSON.stringify(compiler) + "; export default " +
        JSON.stringify({ entry: ["entry." + extension], project: ["*." + extension] }).slice(0, -1) +
        ", compilers: {vibe:compile, vibex:compile}};\n")
      const options = await createOptions({ cwd, args: { exports: true, "no-config-hints": true } })
      options.isShowProgress = false
      const result = await main(options)
      assert.ok(result.counters.processed >= 2, "Knip must process the entry and library")
      reports.push(Object.values(result.issues.exports)
        .flatMap(items => Object.values(items).map(item => item.symbol)).sort())
    }
    assert.deepEqual(reports[1], reports[0], "namespace reads must retain the exports Knip retains in TypeScript")
    if (input.form !== "dynamic") assert.deepEqual(reports[0], ["unusedControl"], "retain the real unused-export finding")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("the namespace-use oracle quotes the current specification", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

test("Knip retains a namespace export read through brackets", async () => {
  for (const extension of ["vibe", "vibex"]) {
    for (const form of ["dot", "single", "double", "escaped", "template", "optional", "dynamic"]) {
      await verify({ extension, form, namespace: "Util", member: "used" })
    }
  }
})

test("Knip namespace reads match TypeScript across computed forms and JSX", async () => {
  await checkProperty(fc, {
    name: "KnipComputedNamespaceUsage",
    rule: "Chapter7: " + quote + " Actual Knip analysis of the TypeScript twin determines which namespace exports are used.",
    command: "node --test packages/compiler/test/knip-namespace.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    numRuns: 48,
    arbitrary: fc.record({
      extension: fc.constantFrom("vibe", "vibex"),
      form: fc.constantFrom("dot", "single", "double", "escaped", "template", "optional", "dynamic"),
      namespace: fc.stringMatching(/^[A-Z][a-z]{1,6}$/),
      member: fc.stringMatching(/^[a-z][a-z0-9]{1,6}$/).map(name => "value_" + name),
      leading: fc.constantFrom("", "// namespace usage\n", "/* source */\n"),
    }),
    check: verify,
  })
})
