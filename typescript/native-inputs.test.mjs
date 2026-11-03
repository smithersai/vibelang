import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../", import.meta.url))
const cli = join(repo, ".smithers/node_modules/.bin/smthrs")
const nativeTargets = ["//typescript:compiler", "//typescript:forms-generator", "//typescript:mapper"]

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-native-inputs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, code) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), code)
  }
  for (const file of ["typescript/PACKAGE.ts", "typescript/tsc/PACKAGE.ts", ".smithers/WORKSPACE.ts", ".smithers/package.json", ".smithers/bun.lock"]) {
    put(file, readFileSync(join(repo, file)))
  }
  put("PACKAGE.ts", 'import { Smithers as S } from "@smthrs/targets"\nexport const Package = S.Package({ targets: {} })\n')
  put("package.json", '{"name":"native-input-fixture","private":true,"type":"module"}\n')
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, "node_modules"), "dir")
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, ".smithers/node_modules"), "dir")
  put("typescript/tsc/go.mod", "module github.com/microsoft/typescript-go\n\ngo 1.27\n")
  put("typescript/tsc/go.sum", "")
  put("typescript/go.work", "go 1.27\nuse ./tsc\n")
  put("scripts/native-output.sh", readFileSync(join(repo, "scripts/native-output.sh")))
  put("typescript/tsc/internal/vibelangestree/estree.go", "package vibelangestree\n")
  put("typescript/tsc/internal/vibelangestree/embedded.txt", "embedded production data\n")
  put("typescript/tsc/internal/vibelangfuzz/spec.go", "package vibelangfuzz\n")
  put("typescript/tsc/internal/vibelangfuzz/vipgen/generate.go", "package vipgen\n")
  put("typescript/tsc/internal/vibelangestree/estree_test.go", "package vibelangestree\n")
  put("typescript/tsc/internal/vibelangestree/testdata/witness.txt", "test witness\n")
  const key = label => {
    const run = spawnSync(cli, ["explain", label], { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    assert.equal(run.status, 0, run.stdout + run.stderr + String(run.error ?? ""))
    const key = /^  key: ([0-9a-f]{64})$/m.exec(run.stdout)?.[1]
    assert.ok(key, run.stdout)
    return key
  }
  return { put, key }
}

test("native build keys ignore fuzz-only changes while test inputs retain them", t => {
  const { put, key } = fixture(t)
  const before = nativeTargets.map(key)
  const testBefore = key("//typescript/tsc:srcs")
  put("typescript/tsc/internal/vibelangfuzz/spec.go", "package vibelangfuzz\n// changed oracle\n")
  put("typescript/tsc/internal/vibelangfuzz/vipgen/generate.go", "package vipgen\n// changed generator\n")
  for (let index = 0; index < 64; index++) {
    const directory = ["", "vipgen/", "nested/deep/"][index % 3]
    const extension = [".go", ".json", ".txt"][Math.floor(index / 3) % 3]
    put("typescript/tsc/internal/vibelangfuzz/" + directory + "witness" + index + extension, "changed fuzz input\n")
  }
  assert.deepEqual(nativeTargets.map(key), before, "fuzz-only changes must not rebuild production executables")
  assert.notEqual(key("//typescript/tsc:srcs"), testBefore, "the Go test inputs must still see changed fuzz oracles")
})

test("native keys retain production code, embedded data and module inputs", t => {
  const { put, key } = fixture(t)
  let previous = key("//typescript:forms-generator")
  for (const [file, code] of [
    ["typescript/tsc/internal/vibelangestree/estree.go", "package vibelangestree\n// production change\n"],
    ["typescript/tsc/internal/vibelangestree/embedded.txt", "changed production data\n"],
    ["typescript/tsc/go.mod", "module github.com/microsoft/typescript-go\n\ngo 1.27.1\n"],
    ["typescript/tsc/go.sum", "changed module checksum\n"],
  ]) {
    put(file, code)
    const next = key("//typescript:forms-generator")
    assert.notEqual(next, previous, "native key must retain " + file)
    previous = next
  }
})

test("decision snapshots stay in test inputs without changing native build keys", t => {
  const { put, key } = fixture(t)
  const base = "typescript/tsc/internal/vibelangmapper/"
  put(base + "forms_decisions.txt", "original decisions\n")
  put(base + "forms_decisions_approved.txt", "original approvals\n")
  put(base + "forms_table.jsonl", "original embedded table\n")
  const before = nativeTargets.map(key)
  const testsBefore = key("//typescript/tsc:srcs")
  for (const name of ["forms_decisions.txt", "forms_decisions_approved.txt"]) {
    put(base + name, "changed " + name + "\n")
    assert.deepEqual(nativeTargets.map(key), before, "runtime decision snapshots must not rebuild executables: " + name)
  }
  assert.notEqual(key("//typescript/tsc:srcs"), testsBefore, "test inputs must retain snapshot changes")
  put(base + "forms_table.jsonl", "changed embedded production table\n")
  const tableChanged = nativeTargets.map(key)
  for (let index = 0; index < nativeTargets.length; index++) {
    assert.notEqual(tableChanged[index], before[index], "embedded table must re-key " + nativeTargets[index])
  }
})
