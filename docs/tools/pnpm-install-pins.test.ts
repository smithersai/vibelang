import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { pnpmInstallProblems, userPnpmInstallProblems } from "./pnpm-install-pins.mjs"

const tick = String.fromCharCode(96)
const block = (language: string, source: string, marker = tick.repeat(3)) =>
  marker + language + "\n" + source + "\n" + marker + "\n"
const command = "pnpm add --save-exact effect@4.1.1 @effect/platform-node@4.1.1"
const document = (yaml: string, marker = tick.repeat(3), file = "pnpm-workspace.yaml") =>
  "With pnpm, add these settings to " + tick + file + tick + ":\n\n" +
  block("yaml", yaml, marker) + "\n" + block("sh", command, marker)
const builds = "allowBuilds:\n  dprint: true"
const fixed = builds + '\noverrides:\n  "@effect/platform-node-shared": "4.1.1"'

test("pnpm installation guides configure the transitive pin in the workspace", () => {
  expect(userPnpmInstallProblems()).toEqual([])
})

test("a package.json override does not satisfy pnpm installation advice", () => {
  const npm = block("json", '{"overrides":{"@effect/platform-node-shared":"4.1.1"}}')
  expect(pnpmInstallProblems(npm + document(builds), "4.1.1")).toHaveLength(1)
  expect(pnpmInstallProblems(npm + document(fixed), "4.1.1")).toEqual([])
})

test("the pin belongs to the workspace root before installation", () => {
  expect(pnpmInstallProblems(document("pnpm:\n  overrides:\n    \"@effect/platform-node-shared\": \"4.1.1\""), "4.1.1")).toHaveLength(1)
  expect(pnpmInstallProblems(document(fixed, tick.repeat(3), "package.json"), "4.1.1")).toHaveLength(1)
  expect(pnpmInstallProblems(block("sh", command) + document(fixed), "4.1.1")).toHaveLength(1)
  for (const value of ["^4.1.1", "4.1.2", null, 4]) {
    expect(pnpmInstallProblems(document("overrides:\n  \"@effect/platform-node-shared\": " + JSON.stringify(value)), "4.1.1")).toHaveLength(1)
  }
})

test("unrelated managers and quoted command examples require no pnpm workspace", () => {
  expect(pnpmInstallProblems(block("sh", command.replace("pnpm", "npm")), "4.1.1")).toEqual([])
  expect(pnpmInstallProblems(block("sh", "echo " + JSON.stringify(command)), "4.1.1")).toEqual([])
  expect(pnpmInstallProblems(block("md", document(builds), tick.repeat(4)), "4.1.1")).toEqual([])
})

test("quoted and listed setup instructions retain the same pin requirement", () => {
  for (const wrap of [
    (text: string) => text.split("\n").map(line => "> " + line).join("\n"),
    (text: string) => "- Setup\n\n" + text.split("\n").map(line => "  " + line).join("\n")
  ]) {
    expect(pnpmInstallProblems(wrap(document(builds)), "4.1.1")).toHaveLength(1)
    expect(pnpmInstallProblems(wrap(document(fixed)), "4.1.1")).toEqual([])
  }
})

test("workspace examples retain the allowed formatter build", () => {
  const text = readFileSync(new URL("../user/src/setup/existing-project.md", import.meta.url), "utf8")
  const yaml = text.split("With pnpm,", 2)[1].match(new RegExp(tick.repeat(3) + "yaml\\n([\\s\\S]*?)" + tick.repeat(3)))![1]
  expect(Bun.YAML.parse(yaml).allowBuilds.dprint).toBe(true)
})

test("generated YAML layouts keep the exact root pin across Markdown and quoting variants", () => {
  fc.assert(fc.property(
    fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 30 })),
    fc.constantFrom('"', "'"), fc.constantFrom('"', "'"),
    fc.constantFrom("  ", "    "), fc.boolean(), fc.boolean(), fc.constantFrom(tick.repeat(3), "~~~"),
    (parts, keyQuote, valueQuote, indent, flow, pinFirst, marker) => {
      const version = parts.join("."), key = keyQuote + "@effect/platform-node-shared" + keyQuote
      const value = valueQuote + version + valueQuote
      const pin = flow ? "overrides: { " + key + ": " + value + " }" :
        "overrides:\n" + indent + key + ": " + value + " # pinned dependency"
      const yaml = pinFirst ? pin + "\n" + builds : builds + "\n" + pin
      expect(pnpmInstallProblems(document(yaml, marker), version)).toEqual([])
      expect(pnpmInstallProblems(document(yaml.replace(value, valueQuote + "^" + version + valueQuote), marker), version)).toHaveLength(1)
      const nested = "pnpm:\n" + pin.split("\n").map(line => "  " + line).join("\n")
      expect(pnpmInstallProblems(document(nested, marker), version)).toHaveLength(1)
      expect(pnpmInstallProblems(document(builds, marker), version)).toHaveLength(1)
    }
  ), { numRuns: 200, seed: 37101 })
})
