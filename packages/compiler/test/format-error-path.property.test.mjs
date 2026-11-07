import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const format = new URL("../format.mjs", import.meta.url).href
const cli = fileURLToPath(new URL("../bin/vibelang-format", import.meta.url))
const skip = !existsSync(new URL("../dprint-plugin.json", import.meta.url)) && "run sh scripts/build-vibelang.sh"
const corpus = JSON.parse(readFileSync(new URL("./format/corpus/smithers-unattributed-error.json", import.meta.url), "utf8"))
const failure = corpus.message

test("formatter failures name the requested file in buffers and batches", { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-format-error-path-"))
  try {
    const preload = join(root, "formatter.cjs")
    // A formatter can fail without returning a path. Exercise that protocol
    // response without relying on a particular upstream layout defect.
    writeFileSync(preload, [
      'const cp = require("node:child_process")',
      'const spawnSync = cp.spawnSync',
      'cp.spawnSync = function (command, args, options) {',
      '  if (String(args?.[0]).endsWith("bin.cjs")) {',
      '    if (args[1] === "output-file-paths") return { status: 0, stdout: "", stderr: "" }',
      '    if (args.includes("--stdin")) return { status: 1, stdout: "", stderr: ' + JSON.stringify(failure) + ' }',
      '  }',
      '  return spawnSync.apply(this, arguments)',
      '}',
      'require("node:module").syncBuiltinESMExports()',
    ].join("\n"))
    const probe = join(root, "probe.mjs")
    writeFileSync(probe, [
      'import { formatSource } from ' + JSON.stringify(format),
      'try { formatSource(process.argv[3], process.argv[2], { lineWidth: 120, quoteStyle: "alwaysDouble" }) }',
      'catch (error) { console.error(error.message); process.exitCode = 2 }',
    ].join("\n"))
    const chars = fc.constantFrom("a", "z", "0", "-", "_", " ", "é", "[", "]", "(", ")", "!")
    const name = fc.array(chars, { minLength: 1, maxLength: 14 }).map(parts => "file-" + parts.join(""))
    const fixture = fc.tuple(name, fc.constantFrom(".vibe", ".vibex", ".ts", ".tsx", ".mts", ".cts"), fc.boolean())
    fc.assert(fc.property(fixture, ([stem, extension, absolute]) => {
      const relative = join("nested", stem + extension)
      const file = absolute ? resolve(root, relative) : relative
      const source = extension.startsWith(".vibe") ? corpus.source : "// @vibe\n" + corpus.source
      const result = spawnSync(process.execPath, ["--require", preload, probe, file, source], { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 2, result.stderr)
      assert.ok(result.stderr.startsWith(file + ": "), JSON.stringify({ file, error: result.stderr }))
      assert.ok(result.stderr.includes(failure), result.stderr)
      assert.doesNotMatch(result.stderr, /0000000\.vibe/)
    }), { seed: 48271, numRuns: 48 })

    const relative = join(...corpus.file.split("/"))
    mkdirSync(dirname(join(root, relative)), { recursive: true })
    const source = corpus.source
    writeFileSync(join(root, relative), source)
    writeFileSync(join(root, ".jj"), "")
    for (const mode of ["--check", "--write"]) {
      const result = spawnSync(process.execPath, ["--require", preload, cli, mode, "branch/*.vibe"], {
        cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
      })
      assert.equal(result.status, 2, result.stderr)
      assert.ok(result.stderr.startsWith(relative + ": "), result.stderr)
      assert.ok(result.stderr.includes(failure), result.stderr)
      assert.equal(readFileSync(join(root, relative), "utf8"), source)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
