import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const cli = join(root, ".smithers/node_modules/.bin/smthrs")
const invoke = (workspace, ...args) => spawnSync(process.execPath, [
  cli, ...args, "--workspace", workspace, "--ui", "plain",
], { encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024 })
const output = result => result.stdout + result.stderr

test("a focused release has the API identity check as a real prerequisite", () => {
  const result = invoke(root, "graph", "//...", "--format", "json", "--filter-output", "edges")
  assert.equal(result.status, 0, output(result))
  const graph = JSON.parse(result.stdout)
  assert.ok(graph.edges.some(edge =>
    edge.from === "//:release" && edge.to === "//:api-identity-test"),
  "excluding API files from the release body must preserve focused API coverage")
  const reachable = new Set(["//:release"])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of graph.edges) if (reachable.has(edge.from) && !reachable.has(edge.to)) {
      reachable.add(edge.to); changed = true
    }
  }
  assert.ok(reachable.has("//typescript:forms-generator"),
  "sharing API coverage must retain the published forms generator prerequisite")
})

test("shared API prerequisites execute once, replay, and block release on failure", t => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-release-graph-"))
  const traceDir = mkdtempSync(join(tmpdir(), "vibelang-release-trace-"))
  t.after(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(traceDir, { recursive: true, force: true })
  })
  const trace = join(traceDir, "calls.jsonl")
  symlinkSync(join(root, ".smithers/node_modules"), join(dir, "node_modules"), "dir")
  writeFileSync(join(dir, "WORKSPACE.ts"),
    readFileSync(join(root, ".smithers/WORKSPACE.ts"), "utf8")
      .replaceAll("//.smithers/package.json", "//package.json"))
  for (const name of ["package.json", "bun.lock"])
    writeFileSync(join(dir, name), readFileSync(join(root, ".smithers", name)))
  writeFileSync(join(dir, "PACKAGE.ts"), [
    'import { Smithers as S } from "@smthrs/targets"',
    'const node = S.Host.bin("node")',
    "const trace = " + JSON.stringify(trace),
    'const api = S.Shell.Test({shell:"node api.mjs",data:[S.file("//api.mjs")],tools:[node],env:{TRACE:trace},sandbox:"none"})',
    'const release = S.Shell.Test({shell:"node release.mjs",data:[api,S.file("//release.mjs")],tools:[node],env:{TRACE:trace},sandbox:"none"})',
    'export const Package = S.Package({targets:{"api-identity-test":api,release}})',
    "",
  ].join("\n"))
  const script = (name, status = 0) =>
    'import { appendFileSync } from "node:fs"; appendFileSync(process.env.TRACE, ' +
    JSON.stringify(name + "\n") + "); process.exit(" + status + ");\n"
  writeFileSync(join(dir, "api.mjs"), script("api"))
  writeFileSync(join(dir, "release.mjs"), script("release"))
  const calls = () => readFileSync(trace, "utf8").trim().split("\n")
  const run = (...labels) => invoke(dir, "test", ...labels, "--jobs", "2")
  let result = run("//:api-identity-test", "//:release")
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "release"], "a target selected twice executes once")
  result = run("//:release")
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "release"], "focused release replays both unchanged results")
  writeFileSync(join(dir, "release.mjs"), script("release changed"))
  result = run("//:release")
  assert.equal(result.status, 0, output(result))
  assert.deepEqual(calls(), ["api", "release", "release changed"], "release-only changes reuse the API result")
  writeFileSync(join(dir, "api.mjs"), script("api failed", 7))
  result = run("//:release")
  assert.notEqual(result.status, 0, output(result))
  assert.equal(result.signal, null, output(result))
  assert.deepEqual(calls(), ["api", "release", "release changed", "api failed"],
    "a failed API prerequisite prevents the release body from running")
})
