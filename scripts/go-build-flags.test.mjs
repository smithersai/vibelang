// Every Go build and test VibeLang's scripts run compiles with the flags the
// build graph uses (`-trimpath`, no `-gcflags`), so they share one set of
// entries in the Go cache.
//
// Go keys a package's compile on its flags. `-gcflags=all=-dwarf=false` gave
// smoke.sh, lsp-smoke.sh and the plugin and mapper tests a second copy of all
// 113 compiler packages: on 2026-11-01, 82 of them were stale for that flag set
// while 1 was stale for `-trimpath`, so a lane that ran scripts/build-vibelang.sh
// and then lsp-smoke.sh compiled the compiler twice. Without `-trimpath` the key
// also holds the checkout's absolute path, so no two workspaces share it.
//
// typescript/Herebyfile.mjs and typescript/tsc/ are upstream TypeScript's and
// keep their own flags.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const scripts = [
  "scripts/build-vibelang.sh",
  "typescript/PACKAGE.ts",
  "PACKAGE.ts",
  "typescript/vibelang/smoke.sh",
  "typescript/vibelang/lsp-smoke.sh",
  "packages/vite/test/run.sh",
  "packages/unplugin/test/run.sh",
  "packages/compiler/test/eslint/run.sh",
  "packages/ts-mapper/test/e2e.sh",
  "packages/ts-mapper/test/parity/run.sh",
  "packages/ts-mapper/test/parity/parity.ts",
  "typescript/VIBELANG.md",
]
const read = (file) => readFileSync(root + file, "utf8")

test("no build or test script passes -gcflags", () => {
  const found = scripts.flatMap((file) =>
    read(file).split("\n").flatMap((line, i) => (/-gcflags[= ]/.test(line) ? [`${file}:${i + 1}`] : [])))
  assert.deepEqual(found, [])
})

test("every go build or go test line compiles with -trimpath", () => {
  const missing = scripts.flatMap((file) => {
    // A declaration's shell can span concatenated source strings. Keep its
    // inline environment with that command, without exempting sibling targets.
    const text = read(file)
    let fenced = false
    let exportedGoflags = false
    let prefix = ""
    return text.split("\n").flatMap((line, i) => {
      const commandLine = prefix + line
      prefix = /"\s*\+\s*$/.test(line) ? commandLine : ""
      if (file.endsWith(".sh")) {
        if (/^\s*export GOFLAGS=/.test(line)) {
          exportedGoflags = /GOFLAGS="?\$\{GOFLAGS:\+\$GOFLAGS \}-trimpath|GOFLAGS=-trimpath(?:\s|$)/.test(line)
        } else if (/^\s*(?:GOFLAGS=|unset\s+GOFLAGS\b)/.test(line)) {
          exportedGoflags = false
        }
      }
      const viaGoflags = exportedGoflags || /GOFLAGS=-trimpath(?:\s|$)/.test(commandLine)
      if (line.startsWith("```")) fenced = !fenced
      // In Markdown, only commands in code blocks; in scripts, not comments, echo or step labels.
      if (file.endsWith(".md") && !fenced) return []
      const runs = /\bgo (build|test)\b|native-output\.sh"? build\b/.test(commandLine) && !/^\s*(#|\/\/|echo\b|step\b)/.test(line)
      return runs && !commandLine.includes("-trimpath") && !viaGoflags ? [`${file}:${i + 1}`] : []
    })
  })
  assert.deepEqual(missing, [])
})

// Run the real source audit in an isolated tree. The other files contain no
// commands: a native declaration mutation must be diagnosed on its own.
function auditNativeSource(t, source, target = "typescript/PACKAGE.ts") {
  const dir = mkdtempSync(join(tmpdir(), "go-build-flags-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const file of scripts) {
    const path = join(dir, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file === target ? source : "")
  }
  const audit = join(dir, "scripts/go-build-flags.test.mjs")
  writeFileSync(audit, readFileSync(new URL(import.meta.url)))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    "--test", "--test-name-pattern=^every go build or go test line", audit
  ], { encoding: "utf8", timeout: 15_000, env })
  assert.ifError(result.error)
  assert.match(result.stdout, /every go build or go test line compiles with -trimpath/)
  return result
}

const nativeSource = read("typescript/PACKAGE.ts")
test("trimpath audit accepts the current native command declarations", t => {
  const result = auditNativeSource(t, nativeSource)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
for (const [name, entry] of [
  ["forms generator", "build ../built/local/vibelang-forms -p 8 -trimpath"],
  ["mapper", "go build -p 8 -trimpath -o ../built/local/vibelang-mapper"],
]) test("trimpath audit rejects a missing flag in the " + name, t => {
  assert.equal(nativeSource.split(entry).length, 2, "the real native command must be unique")
  const changed = nativeSource.replace(entry, entry.replace(" -trimpath", ""))
  const result = auditNativeSource(t, changed)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /typescript\/PACKAGE\.ts:/)
})

// A neighbouring target's assignment is scoped to its own shell command,
// wherever that target is declared and whatever its name is.
test("trimpath audit rejects generated native neighbours with independent environments", t => {
  let samples = 0
  const accepted = []
  for (const position of ["before", "after"]) {
    for (const verb of ["build", "test"]) {
      for (const flag of ["", "-p 8", "-race"]) {
        const neighbour = 'const independent' + samples + ' = { shell: "go ' + verb +
          ' ' + flag + ' ./fixture" }\n'
        const source = position === "before" ? neighbour + nativeSource : nativeSource + neighbour
        const result = auditNativeSource(t, source)
        if (result.status !== 1) accepted.push({ position, verb, flag, status: result.status })
        else assert.match(result.stdout, /typescript\/PACKAGE\.ts:/)
        samples++
      }
    }
  }
  assert.equal(samples, 12)
  assert.deepEqual(accepted, [])
})

for (const [name, source, status] of [
  ["preceding export", 'export GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\ngo build ./fixture\n', 0],
  ["inline assignment", "GOFLAGS=-trimpath go build ./fixture\n", 0],
  ["unrelated assignment", "GOFLAGS=-trimpath go version\ngo build ./fixture\n", 1],
  ["later export", 'go build ./fixture\nexport GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\n', 1],
  ["unset export", 'export GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\nunset GOFLAGS\ngo build ./fixture\n', 1],
]) test("trimpath audit respects shell environment scope: " + name, t => {
  const result = auditNativeSource(t, source, "scripts/build-vibelang.sh")
  assert.equal(result.status, status, result.stdout + result.stderr)
})
