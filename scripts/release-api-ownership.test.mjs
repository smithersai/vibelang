import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { buildContractSuites } from "../build-contract-inputs.ts"
import { declaredCommand, declaredFileCommands } from "./declared-command.mjs"

const declaration = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
const command = name => declaredCommand(declaration, name)

const contracts = command("build-contracts")

const common = [
  "scripts/release/setup.test.mjs",
  "typescript/vibelang/harness.test.mjs",
  "typescript/vibelang/harness-deadlines.test.mjs",
  "typescript/vibelang/cov-ch004-twin.test.mjs",
  "typescript/vibelang/coverage-stock-twins.test.mjs",
  "typescript/vibelang/vip7-reference.test.mjs",
  "docs/redirect/setup.test.mjs",
  "site/scripts/sync-spec-docs.test.mjs",
  "site/scripts/sync-user-docs.test.mjs",
  ".smithers/flows/effect-bump/test/setup.test.mjs",
  ".smithers/flows/ts-bump/test/setup.test.mjs",
  ".smithers/flows/ci-health/test/setup.test.mjs",
  ".smithers/flows/first-bad/test/setup.test.mjs",
  ".smithers/flows/test/setup.test.mjs",
]
const apiFiles = [
  "api-identity", "api-identity-extra", "api-identity space",
  "api-identityλ", "api-identityish", "api-identity'quote",
].map(name => "scripts/" + name + ".test.mjs")
const ordinary = Array.from({ length: 26 }, (_, index) =>
  "scripts/" + ["ordinary ", "xapi-identity", "api_identity", "λ", "quote'"][index % 5] + index + ".test.mjs")
const neighbours = buildContractSuites.flatMap(file => {
  const base = file.slice("scripts/".length, -".test.mjs".length)
  return [base + "-extra", "x" + base, base + " space", base + "λ"]
    .map(name => "scripts/" + name + ".test.mjs")
})
const releaseFiles = [...common, ...ordinary, ...neighbours]

for (const failure of ["none", "api", "release", "contracts"]) {
  test("release delegates API suites and command audits once and preserves " + failure + " failures across filename neighbours", async t => {
    const root = mkdtempSync(join(tmpdir(), "release-api-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const trace = join(root, "trace.jsonl")
    const failedFile = failure === "api" ? apiFiles[0] : failure === "release" ? ordinary[0] : failure === "contracts" ? buildContractSuites[0] : ""
    for (const file of [...releaseFiles, ...apiFiles, ...buildContractSuites]) {
      const path = join(root, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'import test from "node:test"; import {appendFileSync} from "node:fs";\n' +
        "test(" + JSON.stringify(file) + ", () => { appendFileSync(process.env.RELEASE_SELECTION_TRACE, " +
        JSON.stringify(JSON.stringify(file) + "\n") + "); if (process.env.RELEASE_SELECTION_FAIL === " +
        JSON.stringify(file) + ') throw new Error("deliberate selection witness"); });\n')
    }
    const env = { ...process.env, RELEASE_SELECTION_TRACE: trace, RELEASE_SELECTION_FAIL: failedFile }
    delete env.NODE_TEST_CONTEXT
    const invoke = shell => spawnSync("sh", ["-c", shell], {
      cwd: root, env, encoding: "utf8", timeout: 60_000,
    })
    const seen = () => readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse).sort()
    const runFiles = async name => {
      const commands = await declaredFileCommands(name, root), results = []
      let next = 0
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (next < commands.length) {
          const shell = commands[next++]
          results.push(await new Promise(resolve => {
            const child = spawn("sh", ["-c", shell], { cwd: root, env })
            let stdout = "", stderr = ""
            child.stdout.on("data", chunk => stdout += chunk)
            child.stderr.on("data", chunk => stderr += chunk)
            child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }))
          }))
        }
      }))
      return { status: results.some(r => r.status !== 0) ? 1 : 0, signal: results.find(r => r.signal)?.signal ?? null, stdout: results.map(r => r.stdout).join(""), stderr: results.map(r => r.stderr).join("") }
    }
    const first = await runFiles("release")
    assert.equal(first.signal, null, first.stdout + first.stderr)
    assert.equal(first.status, failure === "release" ? 1 : 0, first.stdout + first.stderr)
    assert.deepEqual(seen(), [...releaseFiles].sort(), "release must leave every API file to its dedicated target")
    const second = await runFiles("api-identity-test")
    assert.equal(second.signal, null, second.stdout + second.stderr)
    assert.equal(second.status, failure === "api" ? 1 : 0, second.stdout + second.stderr)
    assert.deepEqual(seen(), [...releaseFiles, ...apiFiles].sort(), "API and build contracts retain separate ownership")
    const third = invoke(contracts)
    assert.equal(third.signal, null, third.stdout + third.stderr)
    assert.equal(third.status, failure === "contracts" ? 1 : 0, third.stdout + third.stderr)
    assert.deepEqual(seen(), [...releaseFiles, ...apiFiles, ...buildContractSuites].sort(),
      "the three declared commands execute every file exactly once")
    if (failure !== "none") assert.match(first.stdout + second.stdout + third.stdout, /deliberate selection witness/)
  })
}
