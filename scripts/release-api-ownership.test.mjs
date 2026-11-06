import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { buildContractExclusions, buildContractSuites } from "../build-contract-inputs.ts"

const declaration = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
function command(name) {
  let marker = (name === "release" ? name : JSON.stringify(name)) + ": check("
  let start = declaration.indexOf(marker)
  if (start < 0) {
    const alias = declaration.match(new RegExp(JSON.stringify(name) + ":\\s*([A-Za-z_][A-Za-z_0-9]*)\\s*,"))
    assert.ok(alias, name + " names its shared check")
    marker = "const " + alias[1] + " = check("
    start = declaration.indexOf(marker)
  }
  assert.ok(start >= 0, name + " declares its check")
  const source = declaration.slice(start + marker.length)
  const literal = /"(?:[^"\\]|\\.)*"/y
  let position = 0
  const space = () => { while (/\s/.test(source[position] ?? "")) position++ }
  const string = () => {
    space()
    literal.lastIndex = position
    const match = literal.exec(source)
    assert.ok(match, name + " uses literal command strings")
    position = literal.lastIndex
    return JSON.parse(match[0])
  }
  string() // summary
  space()
  assert.equal(source[position++], ",")
  const parts = []
  do {
    space()
    if (source.startsWith('buildContractSuites.join(" ")', position)) {
      parts.push(buildContractSuites.join(" "))
      position += 'buildContractSuites.join(" ")'.length
    } else if (source.startsWith("buildContractExclusions", position)) {
      parts.push(buildContractExclusions)
      position += "buildContractExclusions".length
    } else parts.push(string())
    space()
    if (source[position] !== "+") break
    position++
  } while (true)
  assert.equal(source[position], ",")
  return parts.join("")
}

const release = command("release")
const contracts = command("build-contracts")
const apiCheck = command("api-identity-test")
assert.ok(apiCheck.startsWith("node scripts/sync-api-identity.mjs --check && "))
// Exercise the actual test-selection command; the independent source-sync
// prerequisite is unchanged and has its own repository check.
const api = apiCheck.slice(apiCheck.indexOf("node --test "))

const common = [
  "scripts/release/setup.test.mjs",
  "typescript/vibelang/harness.test.mjs",
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
  test("release delegates API suites and command audits once and preserves " + failure + " failures across filename neighbours", t => {
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
    const first = invoke(release)
    assert.equal(first.signal, null, first.stdout + first.stderr)
    assert.equal(first.status, failure === "release" ? 1 : 0, first.stdout + first.stderr)
    assert.deepEqual(seen(), [...releaseFiles].sort(), "release must leave every API file to its dedicated target")
    const second = invoke(api)
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
