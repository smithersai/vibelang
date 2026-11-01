import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// The kernel's stress laws need more than Bun's 5 s default. Bun ignores a timeout key in bunfig.toml,
// and a setDefaultTimeout in the preload reaches the first test file only: Bun resets the default when
// each file starts (1.4.2). The budget is the --timeout flag in experiments/package.json's test script;
// docs/tools/kernel-facts.ts and validate.sh's kernel step pass the same flag.

const repo = fileURLToPath(new URL("../", import.meta.url))
const experiments = join(repo, "experiments")
const preload = join(experiments, "scripts/test-watchdog.ts")
const script = JSON.parse(readFileSync(join(experiments, "package.json"), "utf8")).scripts?.test
assert.ok(script, "experiments/package.json has no test script: a bare `bun test` gives the stress laws 5 s")
const words = script.split(/\s+/)
const budget = Number(words[words.indexOf("--timeout") + 1])

function suite(files, args, preloads = [preload]) {
  const dir = mkdtempSync(join(tmpdir(), "kernel-budget-"))
  try {
    writeFileSync(join(dir, "budget.ts"), 'import { setDefaultTimeout } from "bun:test"\nsetDefaultTimeout(500)\n')
    writeFileSync(join(dir, "bunfig.toml"), `[test]\npreload = ${JSON.stringify(preloads)}\n`)
    for (const [name, ms] of Object.entries(files)) {
      writeFileSync(join(dir, `${name}.test.ts`), `import { test } from "bun:test"\ntest(${JSON.stringify(name)}, async () => { await Bun.sleep(${ms}) })\n`)
    }
    const result = spawnSync("bun", args, { cwd: dir, encoding: "utf8", timeout: 60_000 })
    return { status: result.status, output: result.stdout + result.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test("the test script passes the suite's budget as a flag", () => {
  assert.deepEqual(words.slice(0, 2), ["bun", "test"], script)
  assert.notEqual(words.indexOf("--timeout"), -1, `${script} has no --timeout flag`)
  assert.ok(budget >= 30_000, `${script} gives the stress laws less than 30 s`)
})

test("the docs build passes the same budget", () => {
  const facts = readFileSync(join(repo, "docs/tools/kernel-facts.ts"), "utf8")
  const spawn = /Bun\.spawnSync\(\["bun", "test", "--timeout=(\d+)"\]/.exec(facts)
  assert.ok(spawn, "kernel-facts.ts does not spawn bun test with --timeout")
  assert.equal(Number(spawn[1]), budget, "kernel-facts.ts and experiments/package.json disagree on the budget")
})

test("the flag reaches every test file", () => {
  // Both files outrun a 500 ms budget: the flag applies to the second file as well as the first.
  const run = suite({ a: 700, b: 700 }, ["test", "--timeout", "500"])
  assert.notEqual(run.status, 0, run.output)
  assert.match(run.output, /\(fail\) a .*\n.*timed out after 500ms/, run.output)
  assert.match(run.output, /\(fail\) b .*\n.*timed out after 500ms/, run.output)
})

test("a preload's setDefaultTimeout reaches the first test file only", () => {
  // The reason the budget is a flag. If this fails, Bun keeps a preload's default across files and the
  // suite could set its budget in the watchdog instead.
  const run = suite({ a: 700, b: 700 }, ["test"], ["./budget.ts"])
  assert.match(run.output, /\(fail\) a .*\n.*timed out after 500ms/, run.output)
  assert.match(run.output, /\(pass\) b /, run.output)
})

test("the suite's command runs with the real preload", () => {
  const run = suite({ a: 1 }, words.slice(1))
  assert.equal(run.status, 0, run.output)
  assert.match(run.output, /1 pass/, run.output)
})
