import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
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
  // The real tsc declaration reads this parser corpus when its module loads.
  const jsxCorpus = "typescript/vibelang/cases/vibex-clash"
  mkdirSync(join(root, jsxCorpus), { recursive: true })
  cpSync(join(repo, jsxCorpus), join(root, jsxCorpus), { recursive: true })
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
  return { root, put, key }
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

// Exercise the installed SDK and a real Go linker, not a simulated cache. The
// small command uses the production forms target declaration and native input
// group, so this checks artifact transport without compiling the whole compiler.
test("native producer artifacts replay across clean checkouts and reject stale inputs", { timeout: 300_000 }, t => {
  const first = fixture(t)
  first.put("typescript/tsc/cmd/vibelang-forms/main.go", [
    "package main", "import (", '  _ "embed"', '  "fmt"', ")",
    "//go:embed version.txt", "var version string", "func main() { fmt.Print(version) }", ""
  ].join("\n"))
  first.put("typescript/tsc/cmd/vibelang-forms/version.txt", "producer-one\n")
  const binary = root => join(root, "typescript/built/local/vibelang-forms")
  const build = root => {
    const result = join(root, "result.json")
    rmSync(result, { force: true })
    const run = spawnSync(cli, ["build", "//typescript:forms-generator", "--jobs", "8", "--ui", "plain", "--results-file", result], {
      cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024
    })
    assert.ifError(run.error)
    assert.equal(run.status, 0, run.stdout + run.stderr)
    const summary = JSON.parse(readFileSync(result, "utf8"))
    const entry = summary.results.find(entry => entry.label === "//typescript:forms-generator")
    assert.ok(entry, JSON.stringify(summary))
    return entry.status
  }
  const execute = root => {
    const run = spawnSync(binary(root), [], { encoding: "utf8", timeout: 10_000 })
    assert.ifError(run.error)
    assert.equal(run.status, 0, run.stderr)
    return run.stdout
  }
  assert.equal(build(first.root), "ran")
  assert.equal(execute(first.root), "producer-one\n")
  const bytes = readFileSync(binary(first.root))

  const second = mkdtempSync(join(tmpdir(), "vibelang-native-replay-"))
  t.after(() => rmSync(second, { recursive: true, force: true }))
  // Copy the SDK-owned cache unchanged, including its artifact store; never
  // interpret its records or treat a copied executable as proof of replay.
  cpSync(first.root, second, { recursive: true, filter: path =>
    !["node_modules", ".jj", ".git"].includes(basename(path)) })
  for (const path of ["node_modules", ".smithers/node_modules"]) {
    symlinkSync(join(repo, ".smithers/node_modules"), join(second, path), "dir")
  }
  rmSync(join(second, "typescript/built"), { recursive: true })
  assert.equal(existsSync(binary(second)), false)
  assert.equal(build(second), "hit", "the transferred cache must restore the absent executable")
  assert.ok(existsSync(binary(second)), "cache hit must restore its declared native output")
  assert.deepEqual(readFileSync(binary(second)), bytes)
  assert.equal(execute(second), "producer-one\n")

  writeFileSync(join(second, "README.md"), "documentation change\n")
  writeFileSync(join(second, "typescript/tsc/internal/vibelangfuzz/spec.go"), "package vibelangfuzz\n// oracle change\n")
  writeFileSync(binary(second), "damaged output\n")
  assert.equal(build(second), "hit", "docs and fuzz-only edits retain the native artifact")
  assert.deepEqual(readFileSync(binary(second)), bytes)
  assert.equal(execute(second), "producer-one\n")

  writeFileSync(join(second, "typescript/tsc/cmd/vibelang-forms/version.txt"), "producer-two\n")
  assert.equal(build(second), "ran", "an embedded production input must invalidate the producer")
  assert.equal(execute(second), "producer-two\n")
  assert.notDeepEqual(readFileSync(binary(second)), bytes)

  // Result records alone are insufficient: missing artifact bytes must cause
  // a rebuild rather than reporting a hit with an absent executable.
  rmSync(join(second, ".flows/cas"), { recursive: true, force: true })
  rmSync(binary(second))
  assert.equal(build(second), "ran")
  assert.equal(execute(second), "producer-two\n")
})
