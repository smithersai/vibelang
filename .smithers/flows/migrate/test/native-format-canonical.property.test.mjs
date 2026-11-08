import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { formatVibe } from "../lib/steps.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { formatSource, typescriptPlugin } from "../../../../packages/compiler/format.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const compiler = join(repo, "packages/compiler")
const require = createRequire(join(compiler, "package.json"))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-native-format.json", import.meta.url), "utf8"))
const cli = join(compiler, "bin/vibelang-format")
const run = (root, args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: root, encoding: "utf8", timeout: 60000,
  env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
})
function project(input) {
  const root = mkdtempSync(join(tmpdir(), "native-migration-format-"))
  mkdirSync(join(root, ".jj"))
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  symlinkSync(compiler, join(root, "node_modules/vibelang"), "dir")
  symlinkSync(cli, join(root, "node_modules/.bin/vibelang-format"))
  symlinkSync(join(dirname(require.resolve("dprint/package.json")), "bin.cjs"), join(root, "node_modules/.bin/dprint"))
  const directory = input.nested ? "packages/core/src/space δ" : "src"
  const selected = directory + "/EventSource." + input.extension
  const ignored = directory + "/untouched.vibe"
  const source = input.crlf ? corpus.native.replaceAll("\n", "\r\n") : corpus.native
  for (const file of [selected, ignored, directory + "/ordinary.ts", directory + "/EventSource.d.vibe.ts"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), source)
  }
  const style = { lineWidth: input.width, quoteStyle: input.singleQuote ? "alwaysSingle" : "alwaysDouble" }
  if (input.backend === "dprint") {
    const configDir = input.nested ? "packages/core" : "."
    writeFileSync(join(root, configDir, "dprint.json"), JSON.stringify({
      incremental: false, lineWidth: input.width,
      typescript: { [input.legacySemicolonOption ? "semiColons" : "semicolons"]: "asi", quoteStyle: style.quoteStyle },
      plugins: [typescriptPlugin, "npm:vibelang/dprint-plugin.json"],
    }))
  } else {
    // No enclosing formatter configuration can leak into this fixture.
    writeFileSync(join(root, "dprint.json"), JSON.stringify({
      lineWidth: input.width, typescript: { quoteStyle: style.quoteStyle }, plugins: [],
    }))
  }
  return { root, selected, ignored, source, style, directory,
    config: { target: root, packages: [{ dir: "." }, { dir: "packages/core" }] } }
}
async function check(input) {
  const p = project(input)
  try {
    const before = run(p.root, ["--check", p.selected])
    assert.equal(before.status, 1, before.stderr + before.stdout)
    assert.equal(readFileSync(join(p.root, p.selected), "utf8"), p.source, "a check never rewrites its input")
    const expected = formatSource(p.source, join(p.root, p.selected), p.style)
    assert.notEqual(expected, p.source, "the corpus must expose an unformatted batch")
    const files = [p.selected, p.directory + "/ordinary.ts", p.directory + "/EventSource.d.vibe.ts", "missing.vibe"]
    const log = join(p.root, "format.log")
    assert.deepEqual(await formatVibe(p.config, files, log), { files: [p.selected], code: 0 }, "format stage " + JSON.stringify(input) + "\n" + (existsSync(log) ? readFileSync(log, "utf8").slice(-8192) : "formatter did not produce a stage log"))
    const once = readFileSync(join(p.root, p.selected), "utf8")
    assert.equal(once, expected, "the migration step must use the public formatter's canonical output")
    assert.ok(once.includes("/** Keep the event source contract. */"))
    assert.ok(once.includes("void!never!Req"), "native effect type slots remain native")
    const checked = run(p.root, ["--check", p.selected])
    assert.equal(checked.status, 0, checked.stderr + checked.stdout)
    assert.deepEqual(await formatVibe(p.config, [p.selected], log), { files: [p.selected], code: 0 }, "repeat format stage " + JSON.stringify(input) + "\n" + (existsSync(log) ? readFileSync(log, "utf8").slice(-8192) : "formatter did not produce a stage log"))
    assert.equal(readFileSync(join(p.root, p.selected), "utf8"), once, "formatting is idempotent")
    for (const file of [p.ignored, p.directory + "/ordinary.ts", p.directory + "/EventSource.d.vibe.ts"]) {
      assert.equal(readFileSync(join(p.root, file), "utf8"), p.source, "files outside the selected native source remain untouched")
    }
    assert.match(readFileSync(log, "utf8"), /# exit 0/)
  } finally { rmSync(p.root, { recursive: true, force: true }) }
}
test("native migration formatter contract is quoted from the tooling chapter and flow", () => {
  const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
  assert.ok(chapter.includes("An unparsable file is reported and left unchanged; formatting is idempotent."))
  const flow = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  assert.ok(flow.includes("Record then formats the batch's \x60.vibe\x60 files"))
  assert.ok(flow.includes("with the target's \x60vibelang-format --write\x60 elsewhere."))
})
test("captured event-source pattern becomes canonical through the actual migration formatter", async () => {
  await check({ backend: "fallback", nested: true, extension: "vibe", crlf: false, width: 120, singleQuote: false })
})
test("direct migration formatting uses the pinned plugin's semicolon setting", async () => {
  await check({ backend: "dprint", nested: false, extension: "vibe", crlf: false, width: 80, singleQuote: false })
})
test("a failed native format stage keeps its configuration diagnostic", async () => {
  await assert.rejects(check({
    backend: "dprint", nested: false, extension: "vibe", crlf: false, width: 80,
    singleQuote: false, legacySemicolonOption: true,
  }), /format stage.*Unknown property in configuration \(semiColons\)/s)
})
test("property: native batch formatting respects routing, style, paths and line endings", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    backend: fc.constantFrom("fallback", "dprint"), nested: fc.boolean(),
    extension: fc.constantFrom("vibe", "vibex"), crlf: fc.boolean(),
    width: fc.constantFrom(80, 120), singleQuote: fc.boolean(),
  }), check), { numRuns: 24, seed: 483901 })
})
