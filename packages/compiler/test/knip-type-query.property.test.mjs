import assert from "node:assert/strict"
import { main } from "knip"
import { createOptions } from "knip/session"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const counterpartQuote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
const compiler = new URL("../knip.mjs", import.meta.url).href
const regressions = new URL("./property-regressions/", import.meta.url)
const propertyName = "KnipLocalTypeQueryUsage"
const forms = [
  "parameter",
  "optional",
  "array",
  "intersection",
  "keyof",
  "generic",
  "return",
  "nested",
  "alias",
  "arrow",
  "unused",
]
class LostLocalExportUse extends Error {}

function program(form, name, exported) {
  const head = (exported ? "export " : "") + "const " + name + " = { value: 1 };\n"
  const typ = "typeof " + name
  switch (form) {
    case "parameter":
      return [
        head + "export function read(input: " + typ + "): number { return input.value; }\n",
        "read({value:1})",
      ]
    case "optional":
      return [
        head + "export function read(input?: " + typ + "): number { return input?.value ?? 0; }\n",
        "read({value:1})",
      ]
    case "array":
      return [
        head +
          "export function read(input: ReadonlyArray<" +
          typ +
          ">): number { return input[0]?.value ?? 0; }\n",
        "read([{value:1}])",
      ]
    case "intersection":
      return [
        head +
          "export function read(input: " +
          typ +
          " & {extra?:string}): number { return input.value; }\n",
        "read({value:1})",
      ]
    case "keyof":
      return [
        head + "export function read(input: keyof " + typ + "): number { return input.length; }\n",
        'read("value")',
      ]
    case "generic":
      return [
        head +
          "export function read<T extends " +
          typ +
          ">(input:T): number { return input.value; }\n",
        "read({value:1})",
      ]
    case "return":
      return [head + "export function read(): " + typ + " { return {value:1}; }\n", "read()"]
    case "nested":
      return [
        head +
          "export function read(input: { item: " +
          typ +
          " }): number { return input.item.value; }\n",
        "read({item:{value:1}})",
      ]
    case "alias":
      return [
        head +
          "type Input = " +
          typ +
          "; export function read(input: Input): number { return input.value; }\n",
        "read({value:1})",
      ]
    case "arrow":
      return [
        head + "export const read = (input: " + typ + "): number => input.value;\n",
        "read({value:1})",
      ]
    case "unused":
      return [
        head + "export function read(input:{value:number}):number{return input.value}\n",
        "read({value:1})",
      ]
    default:
      throw new Error(form)
  }
}

// Knip's actual TypeScript analysis is the oracle. This is neither a regex
// model of reference counting nor an assumption that every type query counts
// as a use: the alias/unused controls deliberately retain Knip's own answer.
async function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-knip-query-"))
  const [generated, call] = program(input.form, input.name, input.exported)
  const source = (input.leading ?? "") + generated
  if (input.source !== undefined)
    assert.equal(input.source, source, "consume the literal repository corpus")
  const sides = []
  try {
    for (const extension of ["ts", "vibe"]) {
      const cwd = join(root, extension)
      mkdirSync(cwd)
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({ name: "knip-oracle-" + extension, private: true, type: "module" }),
      )
      writeFileSync(join(cwd, "lib." + extension), source)
      writeFileSync(
        join(cwd, "entry.ts"),
        'import {read} from "./lib.' + extension + '"; console.log(' + call + ");\n",
      )
      writeFileSync(
        join(cwd, "knip.config.ts"),
        "import compile from " +
          JSON.stringify(compiler) +
          '; export default {entry:["entry.ts"],project:["entry.ts","lib.ts","lib.vibe"],compilers:{vibe:compile}};\n',
      )
      const options = await createOptions({ cwd, args: { exports: true, "no-config-hints": true } })
      options.isShowProgress = false
      assert.ok(
        options.configFilePath?.endsWith("knip.config.ts"),
        "Knip must detect this fixture's configuration",
      )
      const result = await main(options)
      assert.ok(result.counters.processed >= 2, "Knip must process the entry and library")
      sides.push(
        Object.entries(result.issues.exports)
          .flatMap(([file, items]) =>
            Object.values(items).map(
              (item) => basename(file).replace(/\.vibe$/, ".ts") + ":" + item.symbol,
            ),
          )
          .sort(),
      )
    }
    const expected = sides[0],
      actual = sides[1]
    const missing = expected.filter((item) => !actual.includes(item))
    const added = actual.filter((item) => !expected.includes(item))
    if (
      input.exported &&
      missing.length === 0 &&
      added.length === 1 &&
      added[0] === "lib.ts:" + input.name
    ) {
      throw new LostLocalExportUse(
        "Vibe surface loses " +
          input.form +
          " use of exported " +
          input.name +
          "; owner migfix-t3code",
      )
    }
    assert.deepEqual(actual, expected, "Vibe and TypeScript must report the same unused exports")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("T3code: Knip retains same-module typeof export usage and native controls", async () => {
  for (const [chapter, text] of [
    ["007-tooling.md", quote],
    ["000-intro.md", counterpartQuote],
  ]) {
    assert.ok(
      readFileSync(SpecPath(chapter), "utf8").includes(text),
      "update the Knip counterpart oracle",
    )
  }
  const records = readdirSync(regressions)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(new URL(name, regressions), "utf8")))
    .filter((record) => record.property === propertyName)
  const pending = new Set(
    records.filter((record) => record.knownFailure).map((record) => record.input.form),
  )
  let unexpectedKnownFailure
  await checkProperty(fc, {
    name: propertyName,
    rule: "Chapter0/7: actual Knip analysis of ordinary TypeScript and its Vibe surface preserves local export uses.",
    command: "node --test packages/compiler/test/knip-type-query.property.test.mjs",
    regressions,
    numRuns: 80,
    arbitrary: fc
      .record({
        form: fc.constantFrom(...forms),
        name: fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/).map((s) => "sample_" + s),
        exported: fc.boolean(),
        leading: fc.constantFrom("", "\n", "// ordinary leading comment\n"),
      })
      .map((input) => (pending.has(input.form) ? { ...input, exported: false } : input)),
    async check(input) {
      try {
        await verify(input)
      } catch (error) {
        if (!(error instanceof LostLocalExportUse)) unexpectedKnownFailure = error
        throw error
      }
    },
  })
  if (unexpectedKnownFailure) throw unexpectedKnownFailure
})
