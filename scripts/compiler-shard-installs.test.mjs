import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const packageSource = readFileSync(new URL("../packages/PACKAGE.ts", import.meta.url), "utf8")
const count = Number(/const COMPILER_TEST_SHARDS = (\d+)/.exec(packageSource)?.[1])
const factory = packageSource.slice(packageSource.indexOf("const compilerTest ="))
const shellExpression = /\bshell:\s*([\s\S]*?),\n\s*\/\//.exec(factory)?.[1]
assert.ok(shellExpression, "compilerTest must declare its shell")
const shellFor = new Function("shard", "COMPILER_TEST_SHARDS", "return (" + shellExpression + ")")

function run(shell, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", shell], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = "", stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
}

test("parallel compiler shards read provisioned dependencies without relinking package tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-shard-install-"))
  try {
    const packageDir = join(root, "packages/compiler")
    const bin = join(root, "bin")
    const records = join(root, "records")
    for (const dir of [bin, records, join(packageDir, "test"), join(packageDir, "native"), join(packageDir, "node_modules/.bin")]) {
      mkdirSync(dir, { recursive: true })
    }
    const tool = join(packageDir, "node_modules/.bin/provisioned-tool")
    writeFileSync(tool, "installed before the graph\n")
    const files = ["alpha.test.mjs", "beta.test.mjs", "gamma.test.mjs"]
    for (const file of files) writeFileSync(join(packageDir, "test", file), "")
    writeFileSync(join(bin, "bun"), '#!/bin/sh\necho "dependency install attempted during a shard" >&2\nexit 73\n', { mode: 0o755 })
    const observer = [
      'const fs = require("node:fs"), path = require("node:path")',
      'const args = process.argv.slice(2)',
      'const shard = args.find(value => value.startsWith("--test-shard=")).split("=")[1]',
      'fs.writeFileSync(path.join(process.env.SHARD_RECORDS, shard.replace("/", "-") + ".json"), JSON.stringify({ args, binary: process.env.VIBELANG_BINARY }))'
    ].join("\n")
    writeFileSync(join(bin, "node"), "#!" + process.execPath + "\n" + observer + "\n", { mode: 0o755 })
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH, SHARD_RECORDS: records }
    assert.ok(count >= 2)
    const results = await Promise.all(Array.from({ length: count }, (_, index) =>
      run(shellFor(index + 1, count), root, env)))
    assert.deepEqual(results.map(({ status, signal, stderr }) => ({ status, signal, stderr })),
      Array.from({ length: count }, () => ({ status: 0, signal: null, stderr: "" })),
      "shards must consume the dependency installation completed by scripts/ci.sh")
    assert.equal(readFileSync(tool, "utf8"), "installed before the graph\n")
    assert.equal(readdirSync(records).length, count, "every shard must reach the test runner")
    for (let shard = 1; shard <= count; shard++) {
      const record = JSON.parse(readFileSync(join(records, shard + "-" + count + ".json"), "utf8"))
      assert.deepEqual(record.args, ["--test", "--test-reporter=../../scripts/testing/node-failures.mjs", "--test-shard=" + shard + "/" + count, ...files.map(file => "test/" + file)])
      assert.equal(record.binary, join(packageDir, "native/vibelang"))
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
