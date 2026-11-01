import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { renameBatch, restoreSpecifiers, rewriteImports } from "../lib/codemod.mjs"
import { parseImports } from "../lib/imports.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// t3code (drive-t3code-server 01:49Z, codemod-gap:vitest-mock-source-specifiers):
// the codemod rewrote ServerBrowser.test.ts's import of the renamed
// ServerBrowserContexts to .vibe but left vi.mock("./ServerBrowserContexts.ts"),
// so the mock no longer matched the module the test loads and the test ran the
// real one.
function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-test-mocks-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

test("t3code: a Vitest mock of a renamed module names it as the rewritten import does, and revert puts it back", (t) => {
  const test = [
    'import { expect, it, vi } from "vite-plus/test";',
    'import { marker } from "./leaf.ts";',
    'vi.mock("./leaf.ts", () => ({ marker: 99 }));',
    'vi.mock("./other.ts", () => ({ other: 1 }));',
    "const actual = await vi.importActual<typeof import('./leaf.js')>('./leaf.js');",
    'vi.doMock("./leaf", () => ({}));',
    'it("uses the existing mock", () => { expect(marker).toBe(99); });',
    ""
  ].join("\n")
  const root = repository(t, { "src/leaf.ts": "export const marker = 73;\n", "src/other.ts": "export const other = 0;\n", "src/leaf.test.ts": test })
  const renames = renameBatch(root, ["src/leaf.ts"])
  const scope = ["src/leaf.vibe", "src/other.ts", "src/leaf.test.ts"]
  const edits = rewriteImports(root, scope, renames.map((r) => r.to))
  const after = readFileSync(join(root, "src/leaf.test.ts"), "utf8")
  assert.match(after, /import \{ marker \} from "\.\/leaf\.vibe";/)
  assert.match(after, /vi\.mock\("\.\/leaf\.vibe", /)
  assert.match(after, /vi\.mock\("\.\/other\.ts", /, "a module the batch did not rename stays as written")
  assert.match(after, /vi\.importActual<typeof import\('\.\/leaf\.vibe'\)>\('\.\/leaf\.vibe'\)/)
  assert.match(after, /vi\.doMock\("\.\/leaf\.vibe", /, "an extensionless path takes the source name, as an import does (D298)")
  assert.equal(edits.filter((e) => e.file === "src/leaf.test.ts").length, 5)
  const restored = restoreSpecifiers(root, edits, "src/leaf.ts")
  assert.equal(restored.length, 5)
  assert.equal(readFileSync(join(root, "src/leaf.test.ts"), "utf8"), test)
})

test("a mock of a package, or a call that only looks like one, is no module specifier", () => {
  const found = parseImports([
    'vi.mock("effect", () => ({}))',
    'jest.requireActual("./a.ts")',
    'vi.hoisted(() => "./b.ts")',
    'const say = "vi.mock(\'./c.ts\')"',
    "myvi.mock('./d.ts')",
    ""
  ].join("\n")).map((i) => `${i.kind} ${i.specifier}`)
  assert.deepEqual(found, ["test-mock effect", "test-mock ./a.ts", "test-mock ./c.ts"])
})

const api = fc.constantFrom("vi.mock", "vi.doMock", "vi.unmock", "vi.doUnmock", "vi.importActual", "vi.importMock", "vitest.mock", "jest.mock", "jest.doMock", "jest.requireActual", "jest.requireMock")
const ext = fc.constantFrom(".ts", ".js", "")
const quote = fc.constantFrom('"', "'")

test("property: every Vitest or Jest mock names what the test's import of the same path names, and revert undoes it", () => {
  fc.assert(fc.property(fc.array(fc.tuple(api, ext, quote, fc.constantFrom("leaf", "other")), { minLength: 1, maxLength: 6 }), ext, (calls, importExt) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-test-mocks-prop-"))
    try {
      const lines = [`import { marker } from "./leaf${importExt}";`, ...calls.map(([call, e, q, name]) => `${call}(${q}./${name}${e}${q});`), ""]
      const text = lines.join("\n")
      writeFileSync(join(root, "leaf.ts"), "export const marker = 73;\n")
      writeFileSync(join(root, "other.ts"), "export const other = 0;\n")
      writeFileSync(join(root, "a.test.ts"), text)
      const renames = renameBatch(root, ["leaf.ts"])
      const edits = rewriteImports(root, ["leaf.vibe", "other.ts", "a.test.ts"], renames.map((r) => r.to))
      const after = readFileSync(join(root, "a.test.ts"), "utf8").split("\n")
      // Every spelling of the module, an extensionless one too, takes its source name (D298).
      const rewrite = () => "./leaf.vibe"
      assert.equal(after[0], `import { marker } from "${rewrite(importExt)}";`)
      calls.forEach(([call, e, q, name], k) => {
        assert.equal(after[k + 1], `${call}(${q}${name === "leaf" ? rewrite(e) : `./other${e}`}${q});`)
      })
      restoreSpecifiers(root, edits, "leaf.ts")
      assert.equal(readFileSync(join(root, "a.test.ts"), "utf8"), text)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 150 })
})
