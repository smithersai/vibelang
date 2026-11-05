import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-source-snippet.json", import.meta.url)))
const fence = String.fromCharCode(96).repeat(3)
const block = (marker, source, eol = "\n") => (marker + "\n\n" + fence + "ts\n" + source + fence + "\n").replaceAll("\n", eol)

async function check({ suffix = "", eol = "\n", stale = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-source-snippet-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"private":true,"workspaces":["packages/*"]}\n')
    put("packages/core/package.json", JSON.stringify({ name: "core", type: "module", private: true, dependencies: { effect: require("effect/package.json").version } }) + "\n")
    put("packages/core/tsconfig.json", '{"compilerOptions":{"strict":true},"include":["src"]}\n')
    const source = corpus.source + "// " + suffix + "\n"
    put("packages/core/src/launcher.ts", source)
    put("packages/core/src/child.ts", "export const child = 1\n")
    const prefix = "A guide " + suffix + eol + eol
    const named = block("<!-- source: src/launcher.ts#start -->", "export const excerpt = 1\n", eol)
    const unmarked = block("Example without a source marker", source, eol)
    const doc = prefix + block(corpus.marker, stale ? "// authored excerpt\n" : source, eol) + eol + named + unmarked
    put("packages/core/README.md", doc)
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    const config = makeConfig({ target: root, packages: ["packages/core"], test: "true", vibelangVersion: "0.0.11", install: "true" })
    const wired = await wireTarget(config, join(root, ".logs"))
    const current = readFileSync(join(root, "packages/core/src/launcher.ts"), "utf8")
    assert.notEqual(current, source, "real source-child wiring must run")
    const actual = readFileSync(join(root, "packages/core/README.md"), "utf8")
    if (stale) {
      assert.equal(actual, doc, "an authored or already stale excerpt is not overwritten")
      assert.ok(wired.warnings.some(warning => warning.includes("README.md") && warning.includes("source snippet")))
    } else {
      assert.equal(actual, prefix + block(corpus.marker, current, eol) + eol + named + unmarked)
      assert.ok(wired.changed.includes("packages/core/README.md"))
      assert.deepEqual(wired.sourceSnippets.changed, ["packages/core/README.md"])
    }
    await wireTarget(config, join(root, ".logs-repeat"))
    assert.equal(readFileSync(join(root, "packages/core/README.md"), "utf8"), actual)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode source snippet follows source-child setup without changing prose or named excerpts", async () => check())
test("source snippet preserves an authored excerpt and records the mismatch", async () => check({ stale: true }))
test("property: source-linked whole-file fences follow final source bytes with either line ending", async () => {
  await fc.assert(fc.asyncProperty(fc.nat(100000), fc.boolean(), async (n, crlf) => check({ suffix: "example" + n, eol: crlf ? "\r\n" : "\n" })), { seed: 110507, numRuns: 12 })
})

test("property: source snippets preserve unrelated fences and refresh only owned source links", async () => {
  const { captureSourceSnippets, refreshSourceSnippets } = await import("../lib/source-snippets.mjs")
  fc.assert(fc.property(fc.nat(100000), fc.boolean(), fc.boolean(), (n, tilde, crlf) => {
    const root = mkdtempSync(join(tmpdir(), "source-snippet-fences-"))
    try {
      const eol = crlf ? "\r\n" : "\n", token = tilde ? "~~~" : fence
      const before = "export const value = " + n + "\n", after = "export const value = " + (n + 1) + "\n"
      const quoted = fence + fence + "\n<!-- source: source.ts -->\n\n" + fence + "ts\n" + before + fence + "\n" + fence + fence + "\n"
      const own = (value) => ("<!-- source: source.ts -->\n\n" + token + "ts\n" + value + token + "\n").replaceAll("\n", eol)
      const named = block("<!-- source: source.ts#value -->", before, eol)
      writeFileSync(join(root, "source.ts"), before)
      writeFileSync(join(root, "README.md"), quoted + own(before) + named)
      const snapshot = captureSourceSnippets(root, ["README.md", "source.ts"])
      writeFileSync(join(root, "source.ts"), after)
      const result = refreshSourceSnippets(root, snapshot)
      assert.deepEqual(result.changed, ["README.md"])
      assert.equal(result.refreshed.length, 1)
      assert.equal(readFileSync(join(root, "README.md"), "utf8"), quoted + own(after) + named)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 110508, numRuns: 80 })
})

test("source snippets preserve concurrent document changes and foreign symlink targets", async () => {
  const { captureSourceSnippets, refreshSourceSnippets } = await import("../lib/source-snippets.mjs")
  const root = mkdtempSync(join(tmpdir(), "source-snippet-boundary-"))
  try {
    mkdirSync(join(root, "repo"))
    writeFileSync(join(root, "outside.ts"), "export const outside = 1\n")
    symlinkSync(join(root, "outside.ts"), join(root, "repo/alias.ts"))
    const doc = block("<!-- source: alias.ts -->", "export const outside = 1\n")
    writeFileSync(join(root, "repo/README.md"), doc)
    assert.deepEqual(captureSourceSnippets(join(root, "repo"), ["README.md", "alias.ts"]), [])
    writeFileSync(join(root, "outside.md"), doc)
    symlinkSync(join(root, "outside.md"), join(root, "repo/linked.md"))
    assert.deepEqual(captureSourceSnippets(join(root, "repo"), ["linked.md", "alias.ts"]), [])

    writeFileSync(join(root, "repo/inside.ts"), "export const value = 1\n")
    writeFileSync(join(root, "repo/README.md"), block("<!-- source: inside.ts -->", "export const value = 1\n"))
    const snapshot = captureSourceSnippets(join(root, "repo"), ["README.md", "inside.ts"])
    writeFileSync(join(root, "repo/inside.ts"), "export const value = 2\n")
    const concurrent = "New prose\n" + readFileSync(join(root, "repo/README.md"), "utf8")
    writeFileSync(join(root, "repo/README.md"), concurrent)
    const result = refreshSourceSnippets(join(root, "repo"), snapshot)
    assert.deepEqual(result.changed, [])
    assert.equal(result.warnings.length, 1)
    assert.equal(readFileSync(join(root, "repo/README.md"), "utf8"), concurrent)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
