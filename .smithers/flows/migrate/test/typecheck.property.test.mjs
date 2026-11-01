import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addCompilerScripts, replaceTsc } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-root-typecheck.json", import.meta.url), "utf8"))

test("alchemy: root typecheck keeps the original build graph and separate test project", () => {
  assert.deepEqual(replaceTsc(corpus.scripts), corpus.expected)
  assert.deepEqual(replaceTsc(corpus.expected), corpus.expected)
})

test("compiler rewiring preserves the shell's project arguments and command order", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-typecheck-"))
  const bin = join(root, "bin")
  mkdirSync(bin)
  // All compilers record the same operation; only their executable changes.
  const body = '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n'
  for (const name of ["tsc", "tsrs", "tsgo", "vibelang"]) writeFileSync(join(bin, name), body, { mode: 0o755 })
  const run = (command) => {
    const result = spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: bin + ":" + process.env.PATH } })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  try {
    const rule = "Surrounding preparation and follow-up commands keep their order"
    assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(rule))
    fc.assert(fc.property(
      fc.constantFrom("tsc", "tsrs", "tsgo"),
      fc.constantFrom("-b", "--build"),
      fc.array(fc.constantFrom("packages/a/tsconfig.json", "packages/b/tsconfig.test.json", "'project with spaces/tsconfig.json'"), { maxLength: 3 }),
      fc.boolean(),
      (compiler, build, projects, watch) => {
        const command = `(${compiler} ${build} ${projects.join(" ")}${watch ? " --watch" : ""}) && ${compiler} --noEmit -p packages/a/tsconfig.test.json`
        const wired = replaceTsc({ typecheck: command }).typecheck
        assert.ok(!new RegExp(`\\b${compiler}\\b`).test(wired), wired)
        assert.equal(run(wired), run(command), command)
        assert.equal(replaceTsc({ typecheck: wired }).typecheck, wired)
      }
    ), { seed: 47047, numRuns: 75 })
    assert.deepEqual(replaceTsc({ other: "tscx && tsrs-helper && my-tsgo" }), { other: "tscx && tsrs-helper && my-tsgo" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("setup wires a solution root even when only leaf packages are selected", () => {
  const root = { private: true, scripts: corpus.scripts, devDependencies: { tsrs: "catalog:" } }
  const wired = addCompilerScripts(root, "file:.vibelang-toolchain/vibelang.tgz")
  assert.deepEqual(wired.scripts, corpus.expected)
  assert.deepEqual(wired.devDependencies, { tsrs: "catalog:", vibelang: "file:.vibelang-toolchain/vibelang.tgz" })
  assert.deepEqual(root.scripts, corpus.scripts)
  assert.deepEqual(addCompilerScripts(wired, "file:.vibelang-toolchain/vibelang.tgz"), wired)
  assert.deepEqual(addCompilerScripts({ scripts: { test: "bun test" } }, "unused"), { scripts: { test: "bun test" } })
})

test("alchemy: a base config implicitly includes files outside the solution graph", () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-root-graph-"))
  try {
    for (const [name, text] of Object.entries(corpus.files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    const config = (name) => ts.getParsedCommandLineOfConfigFile(join(root, name), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")) }, undefined, undefined, [{ extension: ".vibe", isMixedContent: false, scriptKind: ts.ScriptKind.Deferred }])
    const solution = config("tsconfig.json")
    assert.deepEqual(solution.fileNames, [])
    assert.equal(solution.projectReferences.length, 1)
    const leaf = config("packages/app/tsconfig.json")
    assert.deepEqual(leaf.fileNames.map((file) => relative(root, file)), ["packages/app/src/main.vibe"])
    assert.ok(config("tsconfig.base.json").fileNames.some((file) => relative(root, file) === "excluded.ts"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
