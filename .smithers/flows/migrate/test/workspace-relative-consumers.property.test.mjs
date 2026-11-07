import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, posix } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { packagesReaching } from "../lib/wire.mjs"
import { wireNodeTests } from "../lib/node-tests.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-relative-test-import-consumers.json", import.meta.url), "utf8"))

function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "workspace-source-"))
  const before = new Map()
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
    before.set(file, text)
  }
  try {
    put("package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }))
    const dirs = input.nodes.map((_, i) => "packages/p" + i)
    for (const [i, node] of input.nodes.entries()) {
      put(dirs[i] + "/package.json", JSON.stringify({ name: "p" + i, private: true }))
      put(dirs[i] + "/src/leaf." + node.extension, "export const value = 1\n")
      const file = dirs[i] + (node.test ? "/tests/read.test.ts" : "/src/read.ts")
      const imports = [...new Set(node.deps.map(n => n % dirs.length))].map((n, j) => {
        const ext = input.nodes[n].extension
        const path = posix.relative(posix.dirname(file), dirs[n] + "/src/leaf." + (ext === "ts" && node.js ? "js" : ext))
        const specifier = JSON.stringify(path.startsWith(".") ? path : "./" + path)
        switch (node.kind) {
          case "dynamic": return "const value" + j + " = () => import(" + specifier + ")"
          case "type": return "type Value" + j + " = typeof import(" + specifier + ")"
          case "require": return "const value" + j + " = require(" + specifier + ")"
          case "export": return "export { value as value" + j + " } from " + specifier
          default: return "import { value as value" + j + " } from " + specifier
        }
      }).join("\n")
      // A quoted example and a comment are not dependency edges.
      const ignored = JSON.stringify(posix.relative(posix.dirname(file), "packages/unrelated/src/leaf.ts"))
      put(file, imports + "\n// import { value } from " + ignored + "\nconst example = " + JSON.stringify("import { value } from " + ignored) + "\n")
    }
    put("packages/unrelated/package.json", JSON.stringify({ name: "unrelated", private: true }))
    put("packages/unrelated/src/leaf.ts", "export const value = 1\n")
    const migrated = input.nodes.flatMap((n, i) => n.migrated ? [dirs[i]] : [])
    const reaches = (i, path = new Set()) => {
      if (input.nodes[i].migrated) return true
      if (path.has(i)) return false
      const next = new Set([...path, i])
      return input.nodes[i].deps.some(n => reaches(n % dirs.length, next))
    }
    const expected = dirs.filter((_, i) => reaches(i)).sort()
    for (const order of [migrated, [...migrated].reverse()]) {
      assert.deepEqual(packagesReaching(root, order).map(p => p.dir).sort(), expected)
    }
    // The unrelated package remains unselected even when the migrated root's
    // text contains a quoted import of it.
    assert.ok(!packagesReaching(root, ["packages/unrelated"]).some(p => dirs.includes(p.dir)))
    for (const [file, text] of before) assert.equal(readFileSync(join(root, file), "utf8"), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("relative test imports select their consumer without a manifest dependency", () => verify(corpus))
test("relative source consumer oracle quotes the tooling rule", () => assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote)))
test("relative source consumers include transitive cycles and native, runtime and type imports", async () => {
  await checkProperty(fc, {
    name: "workspace-relative-consumers", rule: quote,
    command: "node --test .smithers/flows/migrate/test/workspace-relative-consumers.property.test.mjs",
    regressions: new URL("./corpus/", import.meta.url), numRuns: 120,
    arbitrary: fc.record({ nodes: fc.array(fc.record({
      deps: fc.array(fc.nat({ max: 6 }), { maxLength: 3 }), migrated: fc.boolean(), test: fc.boolean(), js: fc.boolean(),
      extension: fc.constantFrom("ts", "tsx", "vibe", "vibex"), kind: fc.constantFrom("import", "export", "dynamic", "type", "require")
    }), { minLength: 2, maxLength: 6 }) }), check: verify
  })
})


test("setup gives relative test consumers the Node loader without editing their tests", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-relative-loader-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", JSON.stringify({ private: true, workspaces: ["packages/*"] }))
    for (const name of ["b", "a", "c"]) put("packages/" + name + "/package.json", JSON.stringify({ name, private: true, scripts: name === "b" ? {} : { test: "node --test" } }))
    put("packages/b/leaf.vibe", "export const value = 1\n")
    const a = 'import { value } from "../b/leaf.vibe";\n'
    const c = 'import "../a/consumer.test.js";\n'
    put("packages/a/consumer.test.ts", a)
    put("packages/c/consumer.test.ts", c)
    const options = { root, packages: [{ dir: "packages/b" }], ts: require("typescript"), specsFor: () => ({ vibelang: "0.0.12" }) }
    const result = wireNodeTests(options)
    assert.deepEqual(result.warnings, [])
    assert.deepEqual(result.changed.sort(), ["packages/a/package.json", "packages/c/package.json"])
    for (const name of ["a", "c"]) assert.match(JSON.parse(readFileSync(join(root, "packages/" + name + "/package.json"), "utf8")).scripts.test, /--import=vibelang\/register/)
    assert.equal(readFileSync(join(root, "packages/a/consumer.test.ts"), "utf8"), a)
    assert.equal(readFileSync(join(root, "packages/c/consumer.test.ts"), "utf8"), c)
    assert.deepEqual(wireNodeTests(options).changed, [])

    // Stock TypeScript resolves the ordinary source twin to the same producer.
    put("packages/b/leaf.ts", "export const value = 1\n")
    const ts = require("typescript")
    const resolved = ts.resolveModuleName("../b/leaf.ts", join(root, "packages/a/consumer.test.ts"), { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys).resolvedModule
    assert.equal(resolved?.resolvedFileName, join(root, "packages/b/leaf.ts"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

