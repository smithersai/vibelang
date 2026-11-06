import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { after, test } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fc from "fast-check"
import * as compiler from "../vibe-directive.mjs"
import { fileURLToPath, pathToFileURL } from "node:url"

// Exercise each shipped wrapper beside its installed compiler peer.
const installed = mkdtempSync(join(tmpdir(), "vibe-directive-packages-"))
after(() => rmSync(installed, { recursive: true, force: true }))
mkdirSync(join(installed, "node_modules"))
symlinkSync(fileURLToPath(new URL("../", import.meta.url)), join(installed, "node_modules/vibelang"))
async function pluginReader(name) {
  const file = join(installed, name + ".mjs")
  writeFileSync(file, readFileSync(new URL(`../../${name}/src/vibe-directive.js`, import.meta.url)))
  return import(pathToFileURL(file).href)
}
const vite = await pluginReader("vite")
const unplugin = await pluginReader("unplugin")

const readers = { compiler, vite, unplugin }
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-directive-boundary-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test("an unfinished directive prefix does not opt an ordinary TypeScript file in", t => {
  const dir = fixture(t)
  for (const ext of ["ts", "tsx", "mts", "cts"]) {
    const file = join(dir, "main." + ext)
    const text = "// @vibe" + " ".repeat(4096) + "not-a-directive\nexport const n = 1\n"
    writeFileSync(file, text)
    for (const [name, reader] of Object.entries(readers)) {
      assert.equal(reader.hasVibeDirective(file, text), false, name)
      assert.equal(reader.fileHasVibeDirective(file), false, name + " must inspect the complete line")
    }
  }
})

test("disk and buffer directive checks agree across read boundaries", t => {
  const dir = fixture(t)
  fc.assert(fc.property(
    fc.constantFrom("ts", "tsx", "mts", "cts", "d.ts", "d.mts", "d.cts", "d.css.ts", "js"),
    fc.constantFrom("", "\uFEFF", "#!/usr/bin/env node\n", "\uFEFF#!" + "x".repeat(8192) + "\n"),
    fc.oneof(fc.constantFrom(4086, 4088, 4089, 4090, 4095, 4096, 8192), fc.integer({ min: 0, max: 16384 })),
    fc.constantFrom(" ", "\t"),
    fc.constantFrom("", "\nexport const n = 1\n", "\r\nexport const n = 1\n", "ordinary-comment\n", "é\n"),
    (ext, prefix, length, whitespace, tail) => {
      const file = join(dir, "main." + ext)
      const text = prefix + "// @vibe" + whitespace.repeat(length) + tail
      writeFileSync(file, text)
      for (const [name, reader] of Object.entries(readers)) {
        assert.equal(reader.fileHasVibeDirective(file), reader.hasVibeDirective(file, text), name)
      }
    }
  ), { numRuns: 150, seed: 4096 })
})


test("a long ordinary comment keeps Node loading and formatter writes unchanged", t => {
  const dir = fixture(t)
  const file = join(dir, "main.ts")
  const text = "// @vibe" + " ".repeat(4096) + "ordinary-comment\nexport   const n: number = 1\nconsole.log(n)\n"
  writeFileSync(file, text)
  const run = args => spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" })
  const plain = run([file])
  assert.equal(plain.status, 0, plain.stderr)
  const loaded = run(["--import", fileURLToPath(new URL("../register.mjs", import.meta.url)), file])
  assert.equal(loaded.status, 0, loaded.stderr)
  assert.equal(loaded.stdout, plain.stdout)
  const formatted = run([fileURLToPath(new URL("../bin/vibelang", import.meta.url)), "format", "--write", file])
  assert.equal(formatted.status, 0, formatted.stderr)
  assert.equal(readFileSync(file, "utf8"), text)
})

test("source file helpers reject NUL-containing virtual IDs across integrations", async () => {
  const copies = Object.values(readers)
  const text = fc.array(fc.constantFrom("a", "Z", "0", "雪", " ", ".", "-", "_", "/", ":"), { maxLength: 48 }).map(parts => parts.join(""))
  fc.assert(fc.property(text, text, fc.constantFrom(".ts", ".tsx", ".mts", ".cts", ".vibe", ".vibex", ".d.ts", ".js"), (before, after, suffix) => {
    const id = before + "\0" + after + suffix
    for (const copy of copies) {
      assert.equal(copy.fileHasVibeDirective(id), false, JSON.stringify(id))
      assert.equal(copy.isVibeLangFile(id), false, JSON.stringify(id))
    }
  }), { numRuns: 400, seed: 421931 })
})
