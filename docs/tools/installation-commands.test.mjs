import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../", import.meta.url)
const source = readFileSync(new URL("docs/user/src/getting-started/004-installation.md", root), "utf8")

test("installation command examples use scripts supplied to existing projects", () => {
  const packageBlock = [...source.matchAll(/```json\n([\s\S]*?)\n```/g)]
    .map((match) => JSON.parse(match[1]))
    .find((value) => value.scripts)
  assert.ok(packageBlock)
  const commands = source.split("## Compiler commands\n")[1].split("\n## ")[0]
  const scripts = [...commands.matchAll(/^bun run ([a-z][\w:-]*)\s*$/gm)].map((match) => match[1])
  assert.ok(scripts.length >= 3)
  for (const name of scripts) {
    assert.equal(typeof packageBlock.scripts[name], "string", `missing project script: ${name}`)
  }
})
