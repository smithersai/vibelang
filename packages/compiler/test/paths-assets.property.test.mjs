import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { aliasImport, forgetPaths } from "../paths-imports.mjs"

const regression = JSON.parse(readFileSync(new URL("./property-regressions/opencode-asset-alias-enotdir.json", import.meta.url), "utf8"))
const arbitrary = fc.record({
  asset: fc.constantFrom("style.css", "icon.svg", "module.wasm", "two words.txt", "café.css"),
  nested: fc.boolean(),
  fallback: fc.boolean(),
  exact: fc.boolean(),
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-asset-alias-"))
  const put = (file, contents) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), contents)
  }
  try {
    const source = (input.nested ? "nested/" : "") + input.asset
    const specifier = "@/" + source
    const fallback = "fallback/" + source + ".vibe"
    put("src/" + source, "asset")
    if (input.fallback) put(fallback, "export const value = 1")
    put("tsconfig.json", JSON.stringify({ compilerOptions: {
      paths: { [input.exact ? specifier : "@/*"]: input.exact
        ? ["./src/" + source, "./fallback/" + source]
        : ["./src/*", "./fallback/*"] },
    } }))
    forgetPaths()
    const expected = input.fallback ? join(root, fallback) : undefined
    assert.equal(aliasImport(join(root, "tsconfig.json"), specifier), expected)
    assert.equal(aliasImport(join(root, "tsconfig.json"), specifier, { migratedTypeScript: true }), expected)
  } finally {
    forgetPaths()
    rmSync(root, { recursive: true, force: true })
  }
}

test("asset aliases leave native loading intact instead of probing through files", () => check(regression.input))
test("asset aliases continue to a later matching source after a non-directory probe", () => check({ ...regression.input, fallback: true }))
test("asset alias probes preserve native and Vibe fallback across path layouts", async () => {
  await checkProperty(fc, {
    name: "paths-asset-probes", rule: regression.rule, arbitrary, numRuns: 80,
    regressions: new URL("./property-regressions/", import.meta.url),
    command: "bun test test/paths-assets.property.test.mjs",
    check,
  })
})
