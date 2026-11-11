// Module declarations of generated .vibe and .vibex files (VIP-40), with the
// compiler's emit as the oracle: the Bun hook's onResolve filter matches the
// relative name of every body output the compiler writes, .js or, in a .vibex
// file under preserved JSX, .jsx, and the hook serves each one from the
// compiled parent. Run test/run.sh, which sets VIBELANG_BINARY.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { bunResolveFilter, unplugin } from "../src/index.js"

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const rule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."
const compiler = process.env.VIBELANG_BINARY

// Kept and encoded characters; a digit suffix keeps each name unique and
// clear of Effect's globals.
const name = fc.tuple(fc.constantFrom("a", "q", "T", "M", "$", "_", "Ü", "é", "名"), fc.array(fc.constantFrom("a", "9", "_", "B", "$", "ß"), { maxLength: 4 }))
  .map(([first, rest]) => first + rest.join(""))
const generated = fc.record({
  vibex: fc.boolean(),
  jsx: fc.constantFrom("preserve", "react-jsx"),
  names: fc.array(name, { minLength: 1, maxLength: 3 })
})

// The hook the plugin registers with Bun for a project at root.
function bunHook(root) {
  let hook
  unplugin.raw({ root, compiler }, { framework: "bun" }).bun.setup({
    onResolve(options, callback) { hook = { filter: options.filter, resolve: (path, importer) => callback({ path, importer, kind: "import-statement" })?.path } },
    onLoad() {}
  })
  return hook
}

test("the Bun filter and resolver serve every body output the compiler emits, in .vibe and .vibex files", { skip: !compiler && "set VIBELANG_BINARY" }, async () => {
  assert.ok(rule.includes("unplugin"))
  await fc.assert(fc.asyncProperty(generated, async ({ vibex, jsx, names }) => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-body-filter-"))
    try {
      const file = vibex ? "main.vibex" : "main.vibe"
      const lines = names.flatMap((base, i) => [`module ${base}${i} { export const n = ${i} }`, `import { n as v${i} } from ${base}${i}`])
      writeFileSync(join(root, file), [...lines, `export const all: number[] = [${names.map((_, i) => `v${i}`).join(", ")}]`, ""].join("\n"))
      writeFileSync(join(root, "package.json"), '{"type":"module"}')
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
        strict: true, skipLibCheck: true, types: [], jsx, rootDir: ".", outDir: "names" }, include: [file] }))
      const emitted = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
      assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
      const bodies = readdirSync(join(root, "names")).filter((output) => output.startsWith(file + ".") && /\.jsx?$/.test(output))
      assert.equal(bodies.length, names.length)
      const filter = bunResolveFilter(new Set())
      const hook = bunHook(root)
      for (const body of bodies) {
        assert.ok(filter.test("./" + body), `the Bun filter misses ./${body}`)
        assert.equal(hook.resolve("./" + body, join(root, file)), join(root, body), `the hook does not serve ./${body}`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 16 })
})
