import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { aliasImport, forgetPaths } from "../paths-imports.mjs"

const rule = "Bun native launchers follow missing TypeScript paths aliases to migrated sources, preserving native candidates and alias substitution order"
const regression = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-bun-aliased-ts-specifier.json", import.meta.url), "utf8"))
const arbitrary = fc.record({
  inherited: fc.boolean(),
  baseUrl: fc.boolean(),
  exact: fc.boolean(),
  extension: fc.constantFrom("ts", "d.ts", "mts", "cts", "tsx"),
  first: fc.constantFrom("none", "vibe", "ts", "tsx", "d.ts"),
  second: fc.constantFrom("none", "vibe", "ts", "tsx", "d.ts"),
  name: fc.constantFrom("Migrate", "entry", "nested/source", "two words", "café")
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-paths-"))
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), value)
  }
  try {
    const specifier = "@/source." + input.extension
    const config = input.inherited ? "config/base.json" : "tsconfig.json"
    const prefix = input.inherited && !input.baseUrl ? "../" : "./"
    const targets = ["first", "second"].map(dir => prefix + dir + "/" + (input.exact ? input.name + "." + input.extension : "*"))
    const paths = { [input.exact ? specifier : "@/*"]: targets }
    const name = input.exact ? input.name : "source"
    put(config, JSON.stringify({ compilerOptions: { paths, ...(input.baseUrl ? { baseUrl: input.inherited ? ".." : "." } : {}) } }))
    if (input.inherited) put("tsconfig.json", JSON.stringify({ extends: "./config/base.json" }))
    for (const dir of ["first", "second"]) {
      if (input[dir] !== "none") put(dir + "/" + name + "." + input[dir], "export const marker = 42")
    }
    forgetPaths()
    // Native TypeScript spelling is unchanged for ordinary resolver callers.
    const native = ["first", "second"].find(dir => input[dir] === input.extension)
    const baseline = aliasImport(join(root, "tsconfig.json"), specifier)
    assert.equal(baseline && relative(root, baseline), native && native + "/" + name + "." + input.extension)
    // This fallback is only for .ts, never a declaration or another source kind.
    const supported = input.extension === "ts" ? ["ts", "tsx", "d.ts", "vibe"] : [input.extension]
    const selected = ["first", "second"].find(dir => supported.includes(input[dir]))
    const expected = selected && selected + "/" + name + "." + input[selected]
    const actual = aliasImport(join(root, "tsconfig.json"), specifier, { migratedTypeScript: true })
    assert.equal(actual && relative(root, actual), expected, JSON.stringify(input))
  } finally {
    forgetPaths()
    rmSync(root, { recursive: true, force: true })
  }
}

test("Bun paths aliases preserve native candidates before migrated siblings", () => {
  for (const first of ["ts", "tsx", "d.ts", "vibe", "none"]) check({ ...regression.input, first, second: "vibe" })
})

test("Bun paths aliases cover inherited configurations and generated source layouts", async () => {
  await checkProperty(fc, {
    name: "bun-migrated-paths", rule,
    arbitrary, numRuns: 120,
    regressions: new URL("./property-regressions/", import.meta.url),
    command: "node --test test/bun-paths.property.test.mjs",
    check
  })
})
