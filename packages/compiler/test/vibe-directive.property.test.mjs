// Property-based differential fuzzer for packages/compiler/vibe-directive.mjs.
//
// Universal oracle:
//   1. `fileHasVibeDirective(path)` (4096-byte buffered head read) MUST always
//      agree with `hasVibeDirective(path, fullText)`, including when BOMs,
//      shebangs, multi-byte UTF-8 characters, or long first lines straddle the
//      4096-byte buffer boundary.
//   2. Declaration files (`.d.ts`, `.d.mts`, `.d.cts`, `.d.vibe.ts`, `.d.foo.ts`)
//      NEVER match `hasVibeDirective` or `fileHasVibeDirective`, even with `// @vibe`.
//   3. `isVibeLangFile(path)` agrees with `.vibe`/`.vibex` suffix or `fileHasVibeDirective`,
//      and safely returns `false` on NUL bytes, missing files, and directories.

import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { fileHasVibeDirective, hasVibeDirective, isVibeLangFile } from "../vibe-directive.mjs"

const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".d.vibe.ts",
  ".d.vibex.ts",
  ".d.custom.ts",
  ".vibe",
  ".vibex",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
]

const DIRECTIVE_LINES = [
  "// @vibe",
  "// @vibe   ",
  "// @vibe\t \t",
  "// @vibelang",
  "// @vibe extra",
  " // @vibe",
  "/* @vibe */",
  "const x = '// @vibe'",
  "",
]

const LINE_ENDINGS = ["", "\n", "\r\n", "\r"]

function buildText(input) {
  const bom = input.bom ? "\uFEFF" : ""
  const shebang = input.hasShebang
    ? `#!${input.shebangChar.repeat(input.shebangLen)}${input.shebangEnding}`
    : ""
  const pad = input.padSpaces ? " ".repeat(input.padSpaces) : ""
  const body = input.trailingBody
  return `${bom}${shebang}${input.directiveLine}${pad}${input.lineEnding}${body}`
}

test("property: fileHasVibeDirective matches hasVibeDirective across extensions, encodings, and 4096-byte boundaries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vl-directive-fuzz-"))
  let counter = 0
  try {
    await checkProperty(fc, {
      name: "vibe-directive-head-parity",
      rule: "VIP-42: buffered fileHasVibeDirective must always match hasVibeDirective across BOMs, shebangs, multi-byte UTF-8, and 4096-byte boundaries.",
      command: "cd packages/compiler && node --test test/vibe-directive.property.test.mjs",
      numRuns: 200,
      arbitrary: fc.record({
        ext: fc.constantFrom(...EXTENSIONS),
        bom: fc.boolean(),
        hasShebang: fc.boolean(),
        shebangChar: fc.constantFrom("a", "/", "é", "😀"),
        shebangLen: fc.constantFrom(0, 10, 4080, 4094, 4095, 4096, 4097, 4120),
        shebangEnding: fc.constantFrom("\n", "\r\n", ""),
        directiveLine: fc.constantFrom(...DIRECTIVE_LINES),
        padSpaces: fc.constantFrom(0, 1, 8, 4085, 4090, 4096),
        lineEnding: fc.constantFrom(...LINE_ENDINGS),
        trailingBody: fc.constantFrom("", "export const x = 1\n", "// @vibe\n"),
      }),
      check(input) {
        const text = buildText(input)
        const filePath = join(dir, `f${counter++}${input.ext}`)
        writeFileSync(filePath, text, "utf8")

        const fromText = hasVibeDirective(filePath, text)
        const fromDisk = fileHasVibeDirective(filePath)
        assert.equal(
          fromDisk,
          fromText,
          `fileHasVibeDirective (${fromDisk}) !== hasVibeDirective (${fromText}) for ext=${input.ext} len=${Buffer.byteLength(text)}`,
        )

        const isVibeExt = /\.vibex?$/.test(filePath)
        assert.equal(
          isVibeLangFile(filePath),
          isVibeExt || fromText,
          `isVibeLangFile mismatch for ${filePath}`,
        )

        // Declaration files must NEVER match the directive rule.
        if (/\.d\.(?:[cm]ts|(?:[^./\\]+\.)?ts)$/.test(input.ext)) {
          assert.equal(fromText, false, `declaration file ${input.ext} must not match hasVibeDirective`)
          assert.equal(fromDisk, false, `declaration file ${input.ext} must not match fileHasVibeDirective`)
        }
      },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("vibe-directive edge controls: NUL bytes, directories, and missing paths never throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "vl-directive-edge-"))
  try {
    const subDir = join(dir, "fake.ts")
    mkdirSync(subDir)
    assert.equal(fileHasVibeDirective(subDir), false)
    assert.equal(isVibeLangFile(subDir), false)
    assert.equal(fileHasVibeDirective(join(dir, "missing.ts")), false)
    assert.equal(isVibeLangFile(join(dir, "missing.ts")), false)
    assert.equal(fileHasVibeDirective(join(dir, "bad\0.ts")), false)
    assert.equal(isVibeLangFile(join(dir, "bad\0.vibe")), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
