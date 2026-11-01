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
import { readFileSync } from "node:fs"
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
    const text = read(file)
    const viaGoflags = /GOFLAGS="?\$\{GOFLAGS:\+\$GOFLAGS \}-trimpath|GOFLAGS=-trimpath/.test(text)
    let fenced = false
    return text.split("\n").flatMap((line, i) => {
      if (line.startsWith("```")) fenced = !fenced
      // In Markdown, only commands in code blocks; in scripts, not comments, echo or step labels.
      if (file.endsWith(".md") && !fenced) return []
      const runs = /\bgo (build|test)\b|native-output\.sh"? build\b/.test(line) && !/^\s*(#|\/\/|echo\b|step\b)/.test(line)
      return runs && !line.includes("-trimpath") && !viaGoflags ? [`${file}:${i + 1}`] : []
    })
  })
  assert.deepEqual(missing, [])
})
