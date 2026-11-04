import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, unlinkSync, utimesSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import fc from "fast-check"
import { compileProjectSync, projectBackend } from "../project.mjs"

async function check({ stream, unit, prefix = "", category = "error", tail = [], location = "none", split = 1 }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-project-unicode-"))
  const compiler = join(root, "compiler.mjs")
  const project = join(root, "tsconfig.json")
  const file = join(root, "入力🚀.vibe")
  const text = prefix + unit.repeat(Math.ceil(200_000 / unit.length))
  const code = category === "error" ? "TS2322" : "EK4609"
  const nameOffset = Buffer.byteLength(file.slice(0, file.lastIndexOf("入")))
  const offset = nameOffset + (location === "diagnostic" ? Buffer.byteLength(file + "\n") : 0)
  const banner = location === "none" ? "" : "b".repeat(65536 - offset - split - 1) + "\n"
  const bytes = Buffer.concat([Buffer.from(text), Buffer.from(tail)])
  const expected = bytes.toString("utf8")
  writeFileSync(file, "export const value = 1\n")
  writeFileSync(project, JSON.stringify({ files: [file] }))
  writeFileSync(compiler, [
    "const bytes = Buffer.concat([Buffer.from(" + JSON.stringify(banner + file + "\n" + file + "(2,3): " + category + " " + code + ": " + text) + "),",
    "Buffer.from(" + JSON.stringify(tail) + "), Buffer.from('\\n')])",
    "await new Promise(resolve => process." + stream + ".write(bytes, resolve))",
    "process.exitCode = " + (category === "error" ? 1 : 0)
  ].join("\n"))
  const backend = projectBackend({ root, compiler, cache: false })
  try {
    const options = { root, compiler, project, cache: false }
    const sync = compileProjectSync(options)
    const async = await backend.compile(project)
    for (const [mode, result] of [["sync", sync], ["async", async]]) {
      assert.deepEqual(result.inputs, [file], mode + " Unicode input path")
      const diagnostics = category === "error" ? result.errors : result.warnings
      assert.equal(diagnostics.length, 1, mode)
      const diagnostic = diagnostics[0]
      assert.deepEqual({ ...diagnostic, text: undefined },
        { file, line: 2, column: 3, category, code, text: undefined }, mode)
      assert.ok(diagnostic.text === expected,
        mode + "/" + stream + ": diagnostic text changed (" + expected.length + " expected chars, " + diagnostic.text.length + " actual)")
      assert.deepEqual(category === "error" ? result.warnings : result.errors, [], mode)
    }
  } finally {
    await backend.close()
    rmSync(root, { recursive: true, force: true })
  }
}

for (const stream of ["stdout", "stderr"]) {
  for (const [name, unit, shifts] of [["two-byte", "é", 2], ["three-byte", "漢", 3], ["four-byte", "🚀", 4]]) {
    for (let prefix = 0; prefix < shifts; prefix++) {
      test(stream + " preserves " + name + " diagnostic text with prefix " + prefix, () =>
        check({ stream, unit, prefix: "x".repeat(prefix) }))
    }
  }
  for (const location of ["input", "diagnostic"]) {
    for (const split of [1, 2]) {
      test(stream + " preserves a " + location + " path at UTF-8 byte split " + split, () =>
        check({ stream, unit: "ASCII", location, split }))
    }
  }
  test(stream + " preserves ASCII warnings", () =>
    check({ stream, unit: "ASCII", category: "warning" }))
  test(stream + " replaces incomplete final UTF-8 like whole-buffer decoding", () =>
    check({ stream, unit: "λ", tail: [0xf0, 0x9f] }))
  test(stream + " replaces malformed UTF-8 like whole-buffer decoding", () =>
    check({ stream, unit: "€", tail: [0xff, 0x80, 0xc0] }))
}

test("generated mixed Unicode compiler messages match synchronous decoding", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      stream: fc.constantFrom("stdout", "stderr"),
      unit: fc.array(fc.constantFrom("A", "é", "λ", "漢", "€", "🚀", "𐐷"), { minLength: 1, maxLength: 12 }).map(chars => chars.join("")),
      prefix: fc.integer({ min: 0, max: 31 }).map(size => "x".repeat(size)),
      category: fc.constantFrom("error", "warning"),
      location: fc.constantFrom("none", "input", "diagnostic"),
      split: fc.integer({ min: 1, max: 2 })
    }),
    check
  ), { seed: 20261101, numRuns: 24, endOnFailure: true })
})

test("cached warnings from before incremental UTF-8 decoding are recompiled", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-project-unicode-cache-"))
  const app = join(root, "app")
  mkdirSync(app)
  const compiler = join(root, "compiler.mjs")
  const calls = join(root, "calls")
  const project = join(app, "tsconfig.json")
  const file = join(app, "入力.vibe")
  const cache = { directory: join(root, "cache") }
  const text = "漢🚀".repeat(30_000)
  writeFileSync(file, "export const value = 1\n")
  writeFileSync(project, JSON.stringify({ files: [file] }))
  writeFileSync(compiler, [
    'import { appendFileSync } from "node:fs"',
    "appendFileSync(" + JSON.stringify(calls) + ", 'compile\\n')",
    "await new Promise(resolve => process.stdout.write(" +
      JSON.stringify(file + "\n" + file + "(1,1): warning EK4609: " + text + "\n") + ", resolve))"
  ].join("\n"))
  const old = new Date(Math.floor((Date.now() - 10_000) / 1000) * 1000 + 123)
  for (const path of [file, project, compiler]) utimesSync(path, old, old)
  await delay(120) // Let the real source ctimes leave the cache race window.
  const previous = process.env.VIBELANG_DISABLE_CACHE
  process.env.VIBELANG_DISABLE_CACHE = ""
  const debug = []
  const backend = projectBackend({ root: app, compiler, cache, debug: message => debug.push(message) })
  try {
    // The synchronous path creates a real, valid entry, including snapshots,
    // directory and compiler identities. Only its historical format and broken
    // warning text are replaced to model a pre-fix persisted result.
    const initial = compileProjectSync({ root: app, compiler, project, cache, debug: message => debug.push(message) })
    assert.ok(initial.warnings[0].text === text)
    assert.ok(debug.every(message => !message.includes("not caching")), debug.join("\n"))
    const entries = readdirSync(cache.directory).filter(name => name.endsWith(".json"))
    assert.equal(entries.length, 1, "the real compile populated the cache")
    const current = join(cache.directory, entries[0])
    const entry = JSON.parse(readFileSync(current, "utf8"))
    entry.format = 9
    entry.warnings[0].text = "damaged Unicode: �"
    const legacyName = createHash("sha256").update(JSON.stringify([9, entry.version, project, app]))
      .digest("base64url").slice(0, 32) + ".json"
    unlinkSync(current)
    writeFileSync(join(cache.directory, legacyName), JSON.stringify(entry))
    const result = await backend.compile(project)
    assert.ok(result.warnings[0].text === text, "a historical corrupt warning must not survive a cache hit")
    const replay = await backend.compile(project)
    assert.ok(replay.warnings[0].text === text, "the refreshed entry remains usable")
    assert.ok(debug.some(message => message.includes("from the cache")), debug.join("\n"))
    assert.equal(readFileSync(calls, "utf8"), "compile\ncompile\n", "the old format triggers a fresh compiler run")
  } finally {
    await backend.close()
    if (previous === undefined) delete process.env.VIBELANG_DISABLE_CACHE
    else process.env.VIBELANG_DISABLE_CACHE = previous
    rmSync(root, { recursive: true, force: true })
  }
})
