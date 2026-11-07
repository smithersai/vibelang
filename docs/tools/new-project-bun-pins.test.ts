import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { freshBunInstallProblems } from "./bun-install-pins.mjs"

const tick = String.fromCharCode(96)
const block = (language: string, source: string, fence = tick.repeat(3)) =>
  fence + language + "\n" + source + "\n" + fence + "\n"
const pin = (value: unknown, fence = tick.repeat(3)) =>
  "In package.json:\n\n" + block("json", JSON.stringify(value), fence)
const install = (version: string, fence = tick.repeat(3)) =>
  block("sh", "bun add effect@" + version + " @effect/platform-node@" + version, fence)

test("the Alchemy setup pins the Node helper before installing Effect", () => {
  const expected = JSON.parse(readFileSync(new URL("../../packages/runtime/package.json", import.meta.url), "utf8")).peerDependencies.effect
  const page = readFileSync(new URL("../user/src/platform/alchemy.md", import.meta.url), "utf8")
  expect(freshBunInstallProblems(page, expected)).toEqual([])
})

test("fresh projects need an exact active root pin before the install", () => {
  const version = "4.1.1"
  const good = pin({ overrides: { "@effect/platform-node-shared": version } })
  expect(freshBunInstallProblems(good + install(version), version)).toEqual([])
  expect(freshBunInstallProblems(install(version) + good, version)).toHaveLength(1)
  expect(freshBunInstallProblems(good + block("sh", "bun init -y") + install(version), version)).toHaveLength(1)
  expect(freshBunInstallProblems(pin({ nested: { overrides: { "@effect/platform-node-shared": version } } }) + install(version), version)).toHaveLength(1)
})

test("fresh-project pin validation preserves exact versions across JSON layouts", () => {
  fc.assert(fc.property(
    fc.tuple(fc.nat(20), fc.nat(30), fc.nat(30)),
    fc.constantFrom("overrides", "resolutions"), fc.constantFrom(tick.repeat(3), "~~~"),
    (parts, table, fence) => {
      const version = parts.join(".")
      const config = { [table]: { "@effect/platform-node-shared": version } }
      expect(freshBunInstallProblems(pin(config, fence) + install(version, fence), version)).toEqual([])
      expect(freshBunInstallProblems(pin({ [table]: { "@effect/platform-node-shared": "^" + version } }, fence) + install(version, fence), version)).toHaveLength(1)
      expect(freshBunInstallProblems(install(version, fence) + pin(config, fence), version)).toHaveLength(1)
    }
  ), { seed: 37106, numRuns: 100 })
})
