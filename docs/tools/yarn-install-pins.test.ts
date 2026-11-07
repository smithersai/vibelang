import { expect, test } from "bun:test"
import fc from "fast-check"
import { yarnInstallProblems, userYarnInstallProblems } from "./yarn-install-pins.mjs"

const tick = String.fromCharCode(96)
const block = (language: string, source: string, fence = tick.repeat(3)) =>
  fence + language + "\n" + source + "\n" + fence + "\n"
const command = block("sh", "yarn add --exact effect@4.1.1 @effect/platform-node@4.1.1")
const settings = (value: unknown, fence = tick.repeat(3), file = "package.json") =>
  "In the root " + tick + file + tick + ":\n\n" + block("json", JSON.stringify(value, null, 2), fence)
const pin = { resolutions: { "@effect/platform-node-shared": "4.1.1" } }

test("the Yarn route in setup has a transitive resolution in its install guide", () => {
  expect(userYarnInstallProblems()).toEqual([])
})

test("routing Yarn to npm's packages still requires Yarn's resolution setting", () => {
  const npm = settings({ overrides: { "@effect/platform-node-shared": "4.1.1" } })
  expect(yarnInstallProblems(npm, "4.1.1", true)).toHaveLength(1)
  expect(yarnInstallProblems(npm + settings(pin), "4.1.1", true)).toEqual([])
  expect(yarnInstallProblems(npm + command, "4.1.1")).toHaveLength(1)
  expect(yarnInstallProblems(npm + settings(pin) + command, "4.1.1")).toEqual([])
})

test("resolutions must pin the workspace root before Yarn installs", () => {
  expect(yarnInstallProblems(command + settings(pin), "4.1.1")).toHaveLength(1)
  expect(yarnInstallProblems(settings(pin, tick.repeat(3), "other.json") + command, "4.1.1")).toHaveLength(1)
  expect(yarnInstallProblems(settings({ dependencies: pin }) + command, "4.1.1")).toHaveLength(1)
  for (const value of ["^4.1.1", "4.1.2", 4, null]) {
    expect(yarnInstallProblems(settings({ resolutions: { "@effect/platform-node-shared": value } }) + command, "4.1.1")).toHaveLength(1)
  }
})

test("other managers and fenced Markdown examples are not Yarn recipes", () => {
  expect(yarnInstallProblems(command.replace("yarn add", "npm install"), "4.1.1")).toEqual([])
  expect(yarnInstallProblems(block("sh", 'echo "yarn add effect@4.1.1"'), "4.1.1")).toEqual([])
  expect(yarnInstallProblems(block("md", command, tick.repeat(4)), "4.1.1")).toEqual([])
})

test("quoted and listed recipes retain the root resolution requirement", () => {
  for (const wrap of [
    (text: string) => text.split("\n").map(line => "> " + line).join("\n"),
    (text: string) => "- Setup\n\n" + text.split("\n").map(line => "  " + line).join("\n")
  ]) {
    expect(yarnInstallProblems(wrap(command), "4.1.1")).toHaveLength(1)
    expect(yarnInstallProblems(wrap(settings(pin) + command), "4.1.1")).toEqual([])
  }
})

test("generated manifest and Markdown layouts reject missing, nested, ranged and late resolutions", () => {
  fc.assert(fc.property(
    fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 })),
    fc.integer({ min: 0, max: 6 }), fc.constantFrom(tick.repeat(3), "~~~"), fc.boolean(),
    (parts, indent, fence, otherFirst) => {
      const version = parts.join("."), resolution = { "@effect/platform-node-shared": version }
      const config = otherFirst ? { private: true, resolutions: resolution } : { resolutions: resolution, private: true }
      const render = (value: unknown) => "The root package.json:\n\n" + block("json", JSON.stringify(value, null, indent), fence)
      const recipe = block("sh", "yarn add --exact effect@" + version, fence)
      expect(yarnInstallProblems(render(config) + recipe, version)).toEqual([])
      expect(yarnInstallProblems(render({ overrides: resolution }) + recipe, version)).toHaveLength(1)
      expect(yarnInstallProblems(render({ resolutions: { "@effect/platform-node-shared": "^" + version } }) + recipe, version)).toHaveLength(1)
      expect(yarnInstallProblems(render({ workspace: config }) + recipe, version)).toHaveLength(1)
      expect(yarnInstallProblems(recipe + render(config), version)).toHaveLength(1)
    }
  ), { numRuns: 200, seed: 37102 })
})
