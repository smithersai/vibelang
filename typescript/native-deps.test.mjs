import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = fileURLToPath(new URL("../", import.meta.url))
const executables = ["./cmd/tsc", "./cmd/vibelang-forms", "./cmd/vibelang-mapper"]
const snapshots = ["forms_decisions.txt", "forms_decisions_approved.txt"]

function dependencies(root, targets = executables) {
  const run = spawnSync("go", ["list", "-deps", "-f", '{{.Dir}}|{{join .EmbedFiles ","}}', ...targets], {
    cwd: join(root, "typescript/tsc"), env: { ...process.env, CGO_ENABLED: "0" },
    encoding: "utf8", timeout: 180_000, maxBuffer: 16 * 1024 * 1024
  })
  assert.equal(run.status, 0, run.stdout + run.stderr + String(run.error ?? ""))
  return run.stdout.trim().split("\n").map(line => {
    const [directory, embedded] = line.split("|")
    return { directory, embedded: embedded ? embedded.split(",") : [] }
  })
}

function audit(root, packages) {
  const excluded = join(root, "typescript/tsc/internal/vibelangfuzz")
  assert.deepEqual(packages.filter(({ directory }) => directory === excluded || directory.startsWith(excluded + sep)), [],
    "a new production import requires expanding native inputs before excluding fuzz packages")
  const excludedFiles = snapshots.map(name => join(root, "typescript/tsc/internal/vibelangmapper", name))
  const embedded = packages.flatMap(({ directory, embedded }) => embedded.map(file => join(directory, file)))
  assert.deepEqual(embedded.filter(file => excludedFiles.includes(file)), [],
    "a decision snapshot is a native embed: expand native inputs before excluding it")
}

test("native dependencies and embedded files are covered by native inputs", () => {
  const packages = dependencies(repo)
  assert.ok(packages.length > 20, "must inspect the actual transitive Go dependency graph")
  audit(repo, packages)
  assert.ok(packages.some(({ directory, embedded }) =>
    directory.endsWith(join("internal", "vibelangmapper")) && embedded.includes("forms_table.jsonl")),
  "the production forms table must remain an embedded input")
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-native-embed-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => {
    const target = join(root, "typescript/tsc", file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  put("go.mod", "module example.test/native-audit\n\ngo 1.27\n")
  put("cmd/tsc/main.go", 'package main\nimport _ "example.test/native-audit/internal/vibelangmapper"\nfunc main() {}\n')
  put("internal/vibelangmapper/forms.go", "package vibelangmapper\n")
  for (const name of [...snapshots, "forms_table.jsonl"]) put("internal/vibelangmapper/" + name, "fixture data\n")
  return { root, put, inspect: () => dependencies(root, ["./cmd/tsc"]) }
}

test("real Go embeds of excluded snapshots fail while the production table remains covered", t => {
  const { root, put, inspect } = fixture(t)
  audit(root, inspect())
  for (const name of snapshots) {
    put("internal/vibelangmapper/forms.go", 'package vibelangmapper\nimport _ "embed"\n//go:embed ' + name + '\nvar data string\n')
    const packages = inspect()
    assert.ok(packages.some(pkg => pkg.embedded.includes(name)), "go list must observe the actual directive")
    assert.throws(() => audit(root, packages), /decision snapshot is a native embed/)
  }
  put("internal/vibelangmapper/forms.go", 'package vibelangmapper\nimport _ "embed"\n//go:embed forms_table.jsonl\nvar data string\n')
  audit(root, inspect())
})

test("real native imports of the excluded fuzz package still fail the audit", t => {
  const { root, put, inspect } = fixture(t)
  put("internal/vibelangfuzz/spec.go", "package vibelangfuzz\n")
  put("cmd/tsc/main.go", 'package main\nimport _ "example.test/native-audit/internal/vibelangfuzz"\nfunc main() {}\n')
  assert.throws(() => audit(root, inspect()), /excluding fuzz packages/)
})

test("dependency audit uses the native no-cgo build context even under a cgo-enabled caller", t => {
  const { root, put, inspect } = fixture(t)
  put("internal/vibelangmapper/forms_nocgo.go",
    '//go:build !cgo\n\npackage vibelangmapper\nimport _ "embed"\n//go:embed forms_decisions.txt\nvar noCgoData string\n')
  const previous = process.env.CGO_ENABLED
  try {
    process.env.CGO_ENABLED = "1"
    const packages = inspect()
    assert.ok(packages.some(pkg => pkg.embedded.includes("forms_decisions.txt")),
      "inspect the file the native CGO_ENABLED=0 build would embed")
    assert.throws(() => audit(root, packages), /decision snapshot is a native embed/)
  } finally {
    if (previous === undefined) delete process.env.CGO_ENABLED
    else process.env.CGO_ENABLED = previous
  }
})
