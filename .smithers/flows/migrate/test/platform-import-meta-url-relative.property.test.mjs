// A declaration the platform split moves may read import.meta.url only where
// the result names the module's directory, which the sibling shares. As the
// base of `new URL(path, import.meta.url)`, a path with no leading whitespace
// or C0 controls that does not start with `?` or `#` and is not empty drops
// the base's file name (WHATWG URL relative resolution), so `new URL("results/", import.meta.url)` names the same
// directory from the sibling as `new URL("./results/", import.meta.url)`
// does. The split accepted only paths written with `./` or `../`, so Smithers'
// apps/mvp evals suite stayed TypeScript.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split-import-meta-relative-url.json", import.meta.url), "utf8"))

// The module's exports called in dir: each function's result, with dir written as "<dir>".
async function load(dir, files) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, name.replace(/\.ts$/, ".mjs")), js.replace(/"\.\/([\w.]+)\.ts"/g, '"./$1.mjs"'))
  }
  const m = await import(pathToFileURL(join(dir, "m.mjs")).href)
  const seen = {}
  for (const key of Object.keys(m).sort()) seen[key] = typeof m[key] === "function" ? String(m[key]()).replaceAll(pathToFileURL(dir).href, "<dir>") : String(m[key])
  return seen
}

test("smithers apps/mvp evals suite: a bare relative URL beside the module moves and names the same directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-relative-url-"))
  try {
    const split = splitPlatform(corpus.text, "m.ts", ts)
    assert.ok(split && !split.refused, split?.refused ?? "no split")
    const original = await load(join(root, "o"), { "m.ts": corpus.text })
    const after = await load(join(root, "s"), { "m.ts": split.module, "m.platform.ts": split.platform })
    assert.deepEqual(after, original, split.module + "\n---\n" + split.platform)
    assert.equal(after.resultsDir, "<dir>/results/")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Neighbourhood: the first argument of `new URL(…, import.meta.url)` as a
// string literal, a no-substitution template or a template whose text starts
// before its first substitution, over relative paths with and without `./`,
// absolute paths, other schemes, queries, fragments, the empty string and
// leading whitespace. Oracle, from the URL standard's own resolution: the
// split moves the declaration only when the path resolves to the same URL
// against the module and against its sibling, and then the moved code
// computes the module's own result; every path that starts with a letter,
// digit, `.`, `_`, `-` or `/` moves.
test("a moved new URL(path, import.meta.url) splits exactly when the path names the same URL from the sibling", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-relative-url-prop-"))
  const segment = fc.constantFrom("results", "a", "b.json", "0", "_x", "-y", ".", "..", "")
  const lead = fc.constantFrom("", "./", "../", "/", "//host/", "file:///abs/", "https://e.x/", "?", "#", " ", "\t?", "?q=")
  let runs = 0, moved = 0, refused = 0
  try {
    await fc.assert(fc.asyncProperty(lead, fc.array(segment, { maxLength: 3 }), fc.constantFrom("string", "template", "substitution"), async (start, parts, form) => {
      const path = start + parts.join("/")
      const literal = form === "string" ? JSON.stringify(path) : form === "template" ? "`" + path.replace(/[`\\$]/g, "\\$&") + "`" : "`" + path.replace(/[`\\$]/g, "\\$&") + "${tail}`"
      const text = `import { existsSync } from "node:fs"\nconst tail = ""\nexport const where = (): string => existsSync("x") ? "" : new URL(${literal}, import.meta.url).href\nexport const label = "labels"\n`
      runs++
      const split = splitPlatform(text, "m.ts", ts)
      const same = new URL(path, "file:///d/m.ts").href === new URL(path, "file:///d/m.platform.ts").href
      if (split?.refused) {
        assert.match(split.refused, /reads import\.meta/, text)
        assert.ok(!/^[A-Za-z0-9._\-/]/.test(path), `refused a path beside the module: ${JSON.stringify(path)}\n${split.refused}`)
        refused++
        return
      }
      assert.ok(split, text)
      assert.ok(same, `moved a path that names the file: ${JSON.stringify(path)}`)
      const original = await load(join(root, `o${runs}`), { "m.ts": text })
      const after = await load(join(root, `s${runs}`), { "m.ts": split.module, "m.platform.ts": split.platform })
      assert.deepEqual(after, original, text + "\n---\n" + split.module + "\n---\n" + split.platform)
      moved++
    }), { seed: 2026110720, numRuns: 120 })
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.ok(moved > 40 && refused > 15, `moved ${moved}, refused ${refused} of ${runs}`)
})
