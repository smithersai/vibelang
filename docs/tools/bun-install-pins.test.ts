import { expect, test } from "bun:test"
import fc from "fast-check"
import { bunInstallProblems, userBunInstallProblems } from "./bun-install-pins.mjs"

const tick = String.fromCharCode(96)
const block = (language: string, text: string, fence = tick.repeat(3)) =>
  fence + language + "\n" + text + "\n" + fence + "\n"
const example = (value: unknown, fence = tick.repeat(3), file = "package.json") =>
  "In " + tick + file + tick + ":\n\n" + block("json", JSON.stringify(value, null, 2), fence)
const shared = "@effect/platform-node-shared"
const overrides = { overrides: { [shared]: "4.1.1" } }
const resolutions = { resolutions: { [shared]: "4.1.1" } }
const command = block("sh", "bun add --exact effect@4.1.1 @effect/platform-node@4.1.1")

test("existing-project Bun guides preserve the active dependency pin table", () => {
  expect(userBunInstallProblems()).toEqual([])
})

test("an unconditional overrides example cannot serve a resolutions-based project", () => {
  expect(bunInstallProblems(example(overrides) + command, "4.1.1")).toHaveLength(1)
  expect(bunInstallProblems(example(overrides) + example(resolutions) + command, "4.1.1")).toEqual([])
  expect(bunInstallProblems(example({ ...overrides, ...resolutions }) + command, "4.1.1")).toHaveLength(1)
  expect(bunInstallProblems(example(overrides) + example({ overrides: {}, ...resolutions }) + command, "4.1.1")).toHaveLength(1)
})

test("the alternatives need exact root pins in package.json before installation", () => {
  const good = example(overrides)
  expect(bunInstallProblems(good + command + example(resolutions), "4.1.1")).toHaveLength(1)
  expect(bunInstallProblems(good + example(resolutions, tick.repeat(3), "other.json") + command, "4.1.1")).toHaveLength(1)
  expect(bunInstallProblems(good + example({ workspace: resolutions }) + command, "4.1.1")).toHaveLength(1)
  for (const value of ["^4.1.1", "4.1.2", null, 4]) {
    expect(bunInstallProblems(good + example({ resolutions: { [shared]: value } }) + command, "4.1.1")).toHaveLength(1)
  }
})

test("other managers and fenced or echoed command text are not Bun recipes", () => {
  expect(bunInstallProblems(command.replace("bun add", "npm install"), "4.1.1")).toEqual([])
  expect(bunInstallProblems(block("sh", 'echo "bun add effect@4.1.1"'), "4.1.1")).toEqual([])
  expect(bunInstallProblems(block("md", command, tick.repeat(4)), "4.1.1")).toEqual([])
})

test("quoted and listed recipes need both active-table alternatives", () => {
  for (const wrap of [
    (text: string) => text.split("\n").map(line => "> " + line).join("\n"),
    (text: string) => "- Setup\n\n" + text.split("\n").map(line => "  " + line).join("\n")
  ]) {
    expect(bunInstallProblems(wrap(example(overrides) + command), "4.1.1")).toHaveLength(1)
    expect(bunInstallProblems(wrap(example(overrides) + example(resolutions) + command), "4.1.1")).toEqual([])
  }
})

test("generated layouts distinguish active alternatives from shadowed or late resolutions", () => {
  fc.assert(fc.property(
    fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 })),
    fc.integer({ min: 0, max: 6 }), fc.constantFrom(tick.repeat(3), "~~~"), fc.boolean(),
    (parts, indent, fence, pinFirst) => {
      const version = parts.join("."), pins = { retained: "1.2.3", [shared]: version }
      const o = pinFirst ? { overrides: pins, private: true } : { private: true, overrides: pins }
      const r = pinFirst ? { resolutions: pins, private: true } : { private: true, resolutions: pins }
      const render = (value: unknown) => "The root package.json:\n\n" + block("json", JSON.stringify(value, null, indent), fence)
      const add = block("sh", "bun add --exact effect@" + version, fence)
      expect(bunInstallProblems(render(o) + render(r) + add, version)).toEqual([])
      expect(bunInstallProblems(render(o) + add, version)).toHaveLength(1)
      expect(bunInstallProblems(render({ ...o, ...r }) + add, version)).toHaveLength(1)
      expect(bunInstallProblems(render(o) + render({ overrides: {}, ...r }) + add, version)).toHaveLength(1)
      expect(bunInstallProblems(render(o) + add + render(r), version)).toHaveLength(1)
      expect(bunInstallProblems(render(o) + render({ resolutions: { ...pins, [shared]: "^" + version } }) + add, version)).toHaveLength(1)
    }
  ), { numRuns: 200, seed: 37103 })
})
