import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { checkRelocatedEffect } from "./helpers/relocated-effect.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(root, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(root, "packages/runtime")
const stock = join(modules, "typescript/bin/tsc")
const missing = [native, stock, join(modules, "effect/package.json"), join(runtime, "dist/index.d.ts")].find(path => !existsSync(path))
const skip = missing && "missing test dependency: " + missing
const witness = JSON.parse(readFileSync(new URL("./property-regressions/smithers-relocated-effect-package.json", import.meta.url)))
const rule = witness.rule

const check = input => checkRelocatedEffect(input, { native, modules, runtime })

test("relocated Effect packages follow TypeScript module resolution", () => {
  assert.ok(readFileSync(SpecPath("000-intro.md"), "utf8").includes(rule))
})
test("Smithers numbered package storage retains foreign Effect and Reference identity", { skip }, () => check(witness.input))
test("a conventional physical Effect directory remains supported", { skip }, () => check({ ...witness.input, location: "packages/effect" }))
test("property: resolved Effect identity survives package storage layouts and import forms", { skip }, async () => {
  await checkProperty(fc, {
    name: "RelocatedEffectPackage", rule,
    command: "node --test packages/compiler/test/relocated-effect.property.test.mjs",
    arbitrary: fc.record({
      location: fc.constantFrom("packages/71", ".packages/123", "store/效果 space%25", "packages/effect"),
      subpaths: fc.boolean(), nestedScope: fc.boolean(), newline: fc.constantFrom("\n", "\r\n"), value: fc.integer({ min: -100, max: 100 })
    }),
    check, numRuns: 24,
    regressions: new URL("./property-regressions/", import.meta.url)
  })
})
