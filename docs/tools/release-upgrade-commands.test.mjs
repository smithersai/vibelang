import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { releaseUpgradeProblems } from "./release-upgrade-commands.mjs"

const code = value => String.fromCharCode(96) + value + String.fromCharCode(96)
const section = advice => "## 0.0.13 (unreleased)\n\n### Upgrade from 0.0.12\n\n| Before | After and repair |\n| --- | --- |\n| An old form | " + advice + " |\n"
const command = flags => code("vibelang " + flags)

test("the current release's upgrade table uses supported repair commands", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  assert.deepEqual(releaseUpgradeProblems(notes), [])
})

test("the mutation witness rejects the retired repair command and keeps its line", () => {
  const notes = section("TS2588: run " + command("--fix") + " to write let.")
  assert.deepEqual(releaseUpgradeProblems(notes), [{ line: 7, command: "vibelang --fix", option: "--fix" }])
})

test("current guidance permits manual edits, editor actions and file-list lint fixes", () => {
  for (const advice of [
    "Write " + code("let") + " for the mutated binding.",
    "Apply the editor action after reviewing the source change.",
    "Run " + code("vibelang lint --fix src/main.vibe") + ".",
    "Run " + code("vibelang format --write src/main.vibe") + ".",
    "Do not run " + command("--fix") + "; write the source change.",
    command("--fix") + " is unavailable; write the source change.",
  ]) assert.deepEqual(releaseUpgradeProblems(section(advice)), [])
})

test("a rejected old command may appear in Before and in older release history", () => {
  const notes = section("Write let.").replace("An old form", command("--fix")) +
    "\n## 0.0.12\n### Upgrade from 0.0.11\n| Before | After and repair |\n| --- | --- |\n| An old form | Run " + command("--fix") + ". |\n"
  assert.deepEqual(releaseUpgradeProblems(notes), [])
})

test("a removal notice cannot hide a later positive repair instruction", () => {
  const notes = section("Do not run " + command("--fix") + "; run " + command("--fix-only main.vibe") + ".")
  assert.deepEqual(releaseUpgradeProblems(notes).map(problem => problem.option), ["--fix-only"])
})

test("generated command spellings stay rejected only in current upgrade advice", () => {
  fc.assert(fc.property(
    fc.constantFrom("vibelang", "npx vibelang", "bunx vibelang", "pnpm exec vibelang", "npm exec -- vibelang", "./node_modules/.bin/vibelang", "vibelang@0.0.13"),
    fc.constantFrom("--fix", "--FIX", "--fix-vip-only", "--fix-migration-only", "--fix-only=src/main.vibe", "--fix-legacy-service-keys"),
    fc.constantFrom("", "--project tsconfig.json ", "--pretty false "),
    fc.constantFrom("run ", "use ", ""),
    (launcher, option, flags, verb) => {
      const advice = verb + code(launcher + " " + flags + option) + " to repair the source."
      const found = releaseUpgradeProblems(section(advice))
      assert.equal(found.length, 1)
      assert.equal(found[0].option, option)
      assert.deepEqual(releaseUpgradeProblems("## 0.0.13\n### Upgrade from 0.0.12\nManual edits.\n" +
        section(advice).replace("0.0.13 (unreleased)", "0.0.12")), [])
    }
  ), { numRuns: 160, seed: 3461109 })
})
