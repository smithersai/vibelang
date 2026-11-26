import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

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
