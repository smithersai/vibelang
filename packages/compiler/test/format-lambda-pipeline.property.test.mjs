import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { wireDeveloperTools } from "../../../.smithers/flows/migrate/lib/tooling.mjs"

const compiler = fileURLToPath(new URL("..", import.meta.url))
const native = process.env.VIBELANG_BINARY ?? join(compiler, "native", "vibelang")
const source = readFileSync(new URL("./corpus/t3code-effect-lambda-pipeline.vibe", import.meta.url), "utf8")

async function withFormatter(action) {
  assert.ok(existsSync(native), "build the native compiler before running formatter regressions")
  const root = mkdtempSync(join(tmpdir(), "vibe-formatter-fixed-point-"))
  try {
    for (const name of readdirSync(compiler)) {
      if (/\.(?:mjs|js)$/.test(name) || name === "package.json") copyFileSync(join(compiler, name), join(root, name))
    }
    symlinkSync(join(compiler, "node_modules"), join(root, "node_modules"), "junction")
    const plugin = spawnSync(native, ["--write-dprint-plugin", root], { encoding: "utf8" })
    assert.equal(plugin.status, 0, plugin.stderr)
    const { formatSource } = await import(pathToFileURL(join(root, "format.mjs")).href)
    await action(formatSource)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function fixedPoint(format, text, style) {
  // Chapter 7: "An unparsable file is reported and left unchanged; formatting is idempotent."
  // The process plugin also checks preservation of the parsed program on each pass.
  const once = format(text, "adapter.vibe", style)
  assert.equal(format(once, "adapter.vibe", style), once)
  return once
}

test("an effect-lambda pipeline formats to a fixed point under the shipped defaults", async () => {
  await withFormatter(format => fixedPoint(format, source, { lineWidth: 120, quoteStyle: "alwaysDouble" }))
})

test("effect-lambda pipelines converge across widths, quotes and source layouts", async () => {
  await withFormatter(format => {
    fc.assert(fc.property(
      fc.constantFrom(80, 120, 160), fc.constantFrom("alwaysDouble", "alwaysSingle"),
      fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: 12 }),
      (lineWidth, quoteStyle, comment, crlf, branches) => {
        let text = source.replace("if (pendingChildRequestRoutes.has(nativeRequestId)) return;",
          "if (pendingChildRequestRoutes.has(nativeRequestId)) return;\n" +
          Array.from({ length: branches }, (_, index) => `if (request.type === ${index}) return;`).join("\n"))
        if (comment) text = "// adapter pipeline\n" + text
        if (crlf) text = text.replaceAll("\n", "\r\n")
        fixedPoint(format, text, { lineWidth, quoteStyle })
      },
    ), { numRuns: 50 })
  })
})


test("a supplied formatter backend preserves local legacy semicolon preferences", t => {
  const root = mkdtempSync(join(tmpdir(), "vibe-formatter-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { fmt: "dprint check" } }))
  writeFileSync(join(root, "dprint.json"), JSON.stringify({
    plugins: [],
    typescript: { semiColons: "always", "forStatement.spaceAfterSemiColons": false },
  }))
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
  const config = JSON.parse(readFileSync(join(root, "dprint.json"), "utf8"))
  assert.equal(config.typescript.semicolons ?? config.typescript.semiColons, "always")
  assert.equal(config.typescript["forStatement.spaceAfterSemicolons"] ?? config.typescript["forStatement.spaceAfterSemiColons"], false)
  const result = spawnSync(join(compiler, "node_modules", ".bin", "dprint"),
    ["fmt", "--config", join(root, "dprint.json"), "--stdin", "file.ts"], {
      cwd: root, input: "export const marker=1;for(let i=0;i<1;i++){break}", encoding: "utf8",
    })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /export const marker = 1;/)
  assert.match(result.stdout, /for \(let i = 0;i < 1;i\+\+\)/)
  assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) }).changed, [])
})

test("supplying a formatter preserves inherited legacy settings and their configuration file", t => {
  for (const inherited of ["./style.json", ["./style.json"]]) {
    const root = mkdtempSync(join(tmpdir(), "vibe-formatter-inherited-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const shared = JSON.stringify({ typescript: { semiColons: "always", "forStatement.spaceAfterSemiColons": false } })
    writeFileSync(join(root, "style.json"), shared)
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { fmt: "dprint check" } }))
    writeFileSync(join(root, "dprint.json"), JSON.stringify({ extends: inherited, plugins: [] }))
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) })
    const config = JSON.parse(readFileSync(join(root, "dprint.json"), "utf8"))
    assert.deepEqual(config.extends, inherited)
    assert.equal(readFileSync(join(root, "style.json"), "utf8"), shared)
    const result = spawnSync(join(compiler, "node_modules", ".bin", "dprint"),
      ["fmt", "--config", join(root, "dprint.json"), "--stdin", "file.ts"], {
        cwd: root, input: "export const marker=1;for(let i=0;i<1;i++){break}", encoding: "utf8",
      })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /export const marker = 1;/)
    assert.match(result.stdout, /for \(let i = 0;i < 1;i\+\+\)/)
    assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.12" }) }).changed, [])
  }
})
