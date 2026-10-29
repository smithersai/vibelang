import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = process.env.ESSENTIALS_ROOT ?? resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(join(repo, path), "utf8")

test("agent essentials teach the amended Effect function and failure rules", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  const essentials = read("docs/user/llms-essentials.md")
  for (const text of [skill, essentials]) {
    expect(text).toContain("effect function")
    expect(text).not.toMatch(/\beffect (?:load|main|nameOf|names)\(/)
    expect(text).toContain("catch effect")
    expect(text).toContain("try`/`finally")
    expect(text).toContain("ensuring")
    expect(text).toContain("@throws")
    expect(text).toContain("non-Effect")
    expect(text).toContain("catch` binds like `??")
  }
  expect(skill).toContain("try FileSystem.FileSystem")
  expect(skill).toContain("try Path.Path")
  expect(skill).toContain("Effect-returning functions never throw at the call")
  expect(skill).toContain("each result is an `Exit`")
  expect(skill).toContain("including platform calls inside")
  expect(skill).not.toContain("tryPromise((signal) => fetch")
  expect(skill).toContain("an `extends` clause")
})
