import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = process.env.ESSENTIALS_ROOT ?? resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(join(repo, path), "utf8")

const foreignThrowsGuidance = (text: string) => text.split("\n").some(line =>
  line.includes("`@throws`") && /\bnon-(?:Effect|effectful)\b/.test(line))

const coldFactoryGuidance = (text: string) => text.split("\n").some(line =>
  ["`Effect`, `Stream` or `Layer`", "call it directly", "regardless of `@throws`", "error channel", "`Effect.try`", "cold program"]
    .every(term => line.includes(term)))

const guides = () => [read("packages/compiler/skills/vibelang/SKILL.md"), read("docs/user/llms-essentials.md")]

test("agent essentials teach the amended Effect function and failure rules", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  const essentials = read("docs/user/llms-essentials.md")
  for (const text of [skill, essentials]) {
    expect(text).toContain("effect function")
    expect(text).not.toMatch(/\beffect (?:load|main|nameOf|names)\(/)
    expect(text).toContain("catch effect")
    expect(text).toContain("try`/`finally")
    expect(text).toContain("ensuring")
    expect(foreignThrowsGuidance(text)).toBe(true)
    expect(text).toContain("catch` binds like `??")
  }
  expect(skill).toContain("try FileSystem.FileSystem")
  expect(skill).toContain("try Path.Path")
  expect(coldFactoryGuidance(skill)).toBe(true)
  expect(skill).toContain("each result is an `Exit`")
  expect(skill).toContain("including platform calls inside")
  expect(skill).not.toContain("tryPromise((signal) => fetch")
  expect(skill).toContain("an `extends` clause")
})

test("foreign throw guidance accepts both terms used by the compact guides", () => {
  for (const text of guides()) {
    for (const term of ["non-Effect", "non-effectful"]) {
      expect(foreignThrowsGuidance(text.replace(/\bnon-(?:Effect|effectful)\b/g, term))).toBe(true)
    }
  }
})

test("foreign throw guidance rejects omitted annotations, missing distinctions and unrelated mentions", () => {
  for (const text of guides()) {
    expect(foreignThrowsGuidance(text.replaceAll("`@throws`", "`@other`"))).toBe(false)
    const noDistinction = text.replace(/\bnon-(?:Effect|effectful)\b/g, "effectful")
    expect(foreignThrowsGuidance(noDistinction)).toBe(false)
    expect(foreignThrowsGuidance(noDistinction + "\nAn unrelated note mentions non-Effect functions.\n")).toBe(false)
  }
})

test("cold factory guidance retains direct calls, throw contracts and the error-channel distinction", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  for (const term of ["`Stream`", "`Layer`", "call it directly", "regardless of `@throws`", "error channel", "cold program"]) {
    expect(coldFactoryGuidance(skill.replaceAll(term, "[omitted]"))).toBe(false)
  }
})
