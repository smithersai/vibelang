// checkProperty writes its `command` into failure.json as the replay line,
// which a contributor runs from the repository root. Each one must name a
// test file that exists there.
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const dir = fileURLToPath(new URL(".", import.meta.url))

/** The test files a replay command runs, resolved from the repository root. */
function replayTargets(command) {
  const cd = command.match(/^cd (\S+) && (.*)$/)
  const cwd = cd ? join(repo, cd[1]) : repo
  return (cd ? cd[2] : command).split(/\s+/).filter(word => word.endsWith(".mjs")).map(word => join(cwd, word))
}

/** Every `command: "..."` or `command = "..."` string literal that runs a test file by path (fixture commands name bare files). */
function replayCommands(source) {
  return [...source.matchAll(/\bcommand\s*[:=]\s*(["'`])((?:(?!\1).)*)\1/g)].map(m => m[2])
    .filter(command => /^(cd \S+ && )?node --test\b/.test(command) && /\S\/\S*\.mjs\b/.test(command))
}

test("replayTargets resolves from the repository root or the command's own cd", () => {
  assert.deepEqual(replayTargets("node --test .smithers/flows/migrate/test/a.test.mjs"), [join(repo, ".smithers/flows/migrate/test/a.test.mjs")])
  assert.deepEqual(replayTargets("cd .smithers/flows && node --test migrate/test/a.test.mjs"), [join(repo, ".smithers/flows/migrate/test/a.test.mjs")])
  assert.deepEqual(replayCommands('command: "node --test test/a.test.mjs", x: { command: "node --test --test-reporter=spec smoke.test.mjs" }'), ["node --test test/a.test.mjs"])
})

test("every checkProperty replay command names a test file that exists from the repository root", () => {
  const bad = []
  let checked = 0
  for (const name of readdirSync(dir).filter(n => n.endsWith(".mjs")).sort()) {
    const source = readFileSync(join(dir, name), "utf8")
    if (!/\bcheckProperty\(/.test(source)) continue
    for (const command of replayCommands(source)) {
      checked++
      for (const target of replayTargets(command)) if (!existsSync(target)) bad.push(name + ": " + command)
    }
  }
  assert.ok(checked > 40, "found only " + checked + " replay commands; the scan is broken")
  assert.deepEqual(bad, [])
})
