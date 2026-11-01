import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

// Bun gives a test 5 s unless the command says otherwise: bunfig.toml has no timeout key and a
// preload's setDefaultTimeout reaches the first test file only (scripts/kernel-budget.test.mjs). On a
// loaded host that default failed the kernel laws and the runtime's main tests, whose Node children
// each have 10 s. Every bun test the graph or a package script runs passes --timeout.

const repo = fileURLToPath(new URL("../", import.meta.url))
const read = (path) => readFileSync(new URL(path, new URL("file://" + repo)), "utf8")
const budget = (command) => {
  const flag = /--timeout[= ](\d+)/.exec(command)
  return flag ? Number(flag[1]) : null
}
const invocations = (text) => [...text.matchAll(/bun test\b[^"'`\n&|;)]*/g)].map((m) => m[0])

const packageFiles = ["PACKAGE.ts", "packages/PACKAGE.ts", "typescript/PACKAGE.ts", "typescript/tsc/PACKAGE.ts", "typescript/vibelang/PACKAGE.ts"]
// Package scripts the graph, the validation script or the docs build run.
const manifests = ["experiments/package.json", "packages/runtime/package.json", "docs/tools/package.json", ".smithers/package.json"]

test("every bun test in a PACKAGE.ts shell passes --timeout", () => {
  let seen = 0
  for (const file of packageFiles) {
    for (const command of invocations(read(file))) {
      seen++
      assert.ok(budget(command), `${file}: \`${command.trim()}\` runs at Bun's 5 s default`)
    }
  }
  assert.ok(seen >= 4, `expected the graph's bun test shells, found ${seen}`)
})

test("every package script that runs bun test passes --timeout", () => {
  let seen = 0
  for (const file of manifests) {
    const scripts = JSON.parse(read(file)).scripts ?? {}
    for (const [name, script] of Object.entries(scripts)) {
      for (const command of invocations(script)) {
        seen++
        assert.ok(budget(command), `${file} ${name}: \`${command.trim()}\` runs at Bun's 5 s default`)
      }
    }
  }
  assert.ok(seen >= 4, `expected the packages' bun test scripts, found ${seen}`)
})

test("the runtime budget covers two bounded children per main test", () => {
  const shell = /shell: "cd packages\/runtime && (bun test[^"]*)"/.exec(read("packages/PACKAGE.ts"))
  assert.ok(shell, "packages/PACKAGE.ts has no runtime bun test shell")
  const suite = budget(shell[1])
  assert.ok(suite >= 30_000, `${shell[1]} gives a test less than 30 s`)
  const spawns = [...read("packages/runtime/tests/main.test.ts").matchAll(/Bun\.spawnSync\(([^\n]*)\)/g)].map((m) => m[1])
  assert.ok(spawns.length >= 6, `expected main.test.ts to spawn children, found ${spawns.length}`)
  for (const spawn of spawns) {
    const child = /timeout: ([\d_]+)/.exec(spawn)
    assert.ok(child, `main.test.ts spawns a child with no deadline: ${spawn}`)
    assert.ok(2 * Number(child[1].replaceAll("_", "")) < suite, `two ${child[1]} ms children outrun the ${suite} ms test budget`)
  }
})
