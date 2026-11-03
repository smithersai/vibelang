import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { verifyTestDiff, loadGlob, testDiffMarkdown } from "../lib/test-diff.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const glob = loadGlob([new URL("../../../../docs/tools/", import.meta.url).pathname], ts)
const renames = [{ from: "src/X.ts", to: "src/X.vibe" }]
const check = (a, b, extra = {}) => {
  const scratch = mkdtempSync(join(tmpdir(), "test-diff-"))
  try {
    return verifyTestDiff({ ts, before: { "src/X.ts": "", "test/x.test.ts": a },
      after: { "src/X.vibe": "", "test/x.test.ts": b }, renames, glob, scratch, cwd: "test", ...extra })
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}
const forms = [
  'import { f } from "../src/X.ts"',
  'export { f } from "../src/X.ts"',
  'import "../src/X.ts"',
  'const p = import("../src/X.ts")',
  'const p = require("../src/X.ts")',
  'vi.mock("../src/X.ts", () => ({ f: 1 }))',
  'jest.mock("../src/X.ts")',
  'const p = import(`../src/X.ts`)',
  'const p = require(`../src/X.ts`)',
  'vi.mock(`../src/X.ts`)',
  'jest.mock(`../src/X.ts`)',
  'const p = import(("../src/X.ts"))',
  'const p = require(("../src/X.ts"))',
  'vi.mock(("../src/X.ts"))',
  'jest.mock(("../src/X.ts"))'
]
// docs/design/src/900-appendices.md#85fd984eb14d570b — Chapter 900: mechanical specifier renames preserve module identity.
// docs/design/src/900-appendices.md#d05fdd7479c54be7 — Chapter 900: mechanical specifier renames preserve module identity.
for (const before of forms) test("allows module specifier: " + before, () => {
  const result = check(before, before.replace("X.ts", "X.vibe"))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.files[0].hunks[0].kind, "specifier")
})
test("foldkit docPage selector widens without selecting sidecars", () => {
  const c = JSON.parse(readFileSync(new URL("./corpus/foldkit-docpage-selector.json", import.meta.url)))
  const before = { ...c.files, [c.file]: c.before }
  const after = { [c.file]: c.after }
  for (const { from, to } of c.renames) {
    after[to] = ""
    after[to.replace(".vibe", ".d.vibe.ts")] = ""
  }
  const result = check("", "", { before, after, renames: c.renames })
  assert.equal(result.ok, true, JSON.stringify(result))
  const set = result.files[0].hunks[0].setCheck
  assert.deepEqual(set.before, ["website/docs/a", "website/docs/nested/b"])
  assert.deepEqual(set.after, set.before)
  assert.equal(set.beforeCount, 2)
  assert.match(testDiffMarkdown(result), /website\/docs\/nested\/b/)
})
for (const [name, a, b] of [
  ["assertion", "expect(f()).toBe(1)", "expect(f()).toBe(2)"],
  ["fs path whose text is asserted", 'expect(readFileSync("../src/X.ts")).toBe("text")', 'expect(readFileSync("../src/X.vibe")).toBe("text")'],
  ["template fs path whose text is asserted", 'expect(readFileSync(`../src/X.ts`)).toBe("text")', 'expect(readFileSync(`../src/X.vibe`)).toBe("text")'],
  ["interpolated module path", 'require(`../src/${name}.ts`)', 'require(`../src/${name}.vibe`)'],
  ["embedded config", 'const cfg = "include: *.ts"', 'const cfg = "include: *.vibe"'],
  ["fake module text", 'const cfg = `import "../src/X.ts"`', 'const cfg = `import "../src/X.vibe"`'],
  ["comment", '// import "../src/X.ts"', '// import "../src/X.vibe"'],
  ["unrenamed module", 'import "../src/Y.ts"', 'import "../src/Y.vibe"'],
  ["different path", 'import "../src/X.ts"', 'import "../other/X.vibe"'],
  ["assertion beside allowed edit", forms[0] + "\nexpect(1).toBe(1)", forms[0].replace("X.ts", "X.vibe") + "\nexpect(1).toBe(2)"],
  ["glob options", 'import.meta.glob("../src/*.ts", { eager: true })', 'import.meta.glob(["../src/*.{ts,vibe}", "!../src/*.d.vibe.ts"], { eager: false })']
]) test("rejects " + name, () => assert.equal(check(a, b).ok, false))
test("selector rejects adding, dropping, or importing a sidecar", () => {
  const a = 'const p = import.meta.glob("../src/*.ts")'
  const b = 'const p = import.meta.glob(["../src/*.{ts,vibe}", "!../src/*.d.vibe.ts"])'
  assert.equal(check(a, b).ok, true)
  assert.equal(check(a, b, { after: { "src/X.vibe": "", "src/extra.vibe": "", "test/x.test.ts": b } }).ok, false)
  assert.equal(check(a, b, { after: { "test/x.test.ts": b } }).ok, false)
  assert.equal(check(a, 'const p = import.meta.glob("../src/*.{ts,vibe}")', {
    after: { "src/X.vibe": "", "src/X.d.vibe.ts": "", "test/x.test.ts": 'const p = import.meta.glob("../src/*.{ts,vibe}")' }
  }).ok, false)
})
test("readdir filter uses the directory's entries, including unmigrated siblings", () => {
  const a = 'const files = readdirSync("../src").filter(name => name.endsWith(".ts"))'
  const b = 'const files = readdirSync("../src").filter(name => (name.endsWith(".ts") || name.endsWith(".vibe")) && !name.endsWith(".d.vibe.ts"))'
  assert.equal(check(a, b).ok, true)
  const r = check(a, b, { after: { "src/X.vibe": "", "src/other.ts": "", "test/x.test.ts": b } })
  assert.equal(r.ok, false)
})
test("extension regex in a readdir filter is evaluated, not executed as code", () => {
  const a = 'const files = fs.readdirSync("../src").filter(name => /\\.ts$/.test(name))'
  const b = 'const files = fs.readdirSync("../src").filter(name => /\\.(ts|vibe)$/.test(name) && !name.endsWith(".d.vibe.ts"))'
  assert.equal(check(a, b).ok, true)
  assert.equal(check(a, b.replace('!name.endsWith(".d.vibe.ts")', 'sideEffect(name)')).ok, false)
})
test("fixtures, additions, deletions and malformed source fail closed", () => {
  assert.equal(check("", "", { before: { "fixtures/x.json": '{"a":1}' }, after: { "fixtures/x.json": '{"a":2}' } }).ok, false)
  assert.equal(check("", "", { before: {}, after: { "test/new.ts": "export {}" } }).ok, false)
  assert.equal(check("", "", { before: { "test/old.ts": "" }, after: {} }).ok, false)
  assert.equal(check('import "../src/X.ts"', 'import "../src/X.vibe"; const =').ok, false)
})
// Detail 272 addenda: "any other change to a test ... is still forbidden";
// selectors require "same count, same names". Mix permitted literals with
// independent forbidden edits so one allowed hunk cannot hide another.
// docs/design/src/900-appendices.md#015400b60fa30152 — Chapter 900: an allowed hunk never hides an assertion edit.
test("property: random allowed and forbidden test hunks obey detail 272", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("every byte outside the permitted literal or selector must stay unchanged"))

  fc.assert(fc.property(
    fc.array(fc.record({ allowed: fc.boolean(), value: fc.integer(), form: fc.integer({ min: 0, max: forms.length - 1 }) }), { minLength: 1, maxLength: 12 }),
    entries => {
      const before = entries.map(({ value, form }) => forms[form] + "\nexpect(f()).toBe(" + value + ")").join("\n")
      const after = entries.map(({ allowed, value, form }) => forms[form].replace("X.ts", "X.vibe") + "\nexpect(f()).toBe(" + (allowed ? value : value + 1) + ")").join("\n")
      assert.equal(check(before, after).ok, entries.every(e => e.allowed))
    }), { numRuns: 250, seed: 272 })
})

// docs/design/src/900-appendices.md#fec6bab552afb170 — Chapter 900: fixture and declaration-import-style renames.
// docs/design/src/900-appendices.md#ea561cd7dfcbc03a — Chapter 900: fixture and declaration-import-style renames.
test("specifier styles and TSX renames keep the same module identity", () => {
  for (const [old, next, style] of [["X.ts", "X.js", "js"], ["X.js", "X.vibe", "vibe"], ["X.js", "X.ts", "ts"]]) {
    const a = 'import "../src/' + old + '"'
    const b = 'import "../src/' + next + '"'
    assert.equal(check(a, b, { declarationImportStyle: style }).ok, true)
  }
  assert.equal(check('import "../src/X.tsx"', 'import "../src/X.vibex"', {
    before: { "src/X.tsx": "", "test/x.test.ts": 'import "../src/X.tsx"' },
    after: { "src/X.vibex": "", "test/x.test.ts": 'import "../src/X.vibex"' },
    renames: [{ from: "src/X.tsx", to: "src/X.vibex" }]
  }).ok, true)
  assert.equal(check(forms[0], forms[0].replace("X.ts", "X.vibe"), { renames: [] }).ok, false)
  assert.equal(check(forms[0], forms[0].replace("X.ts", "X.vibe"), {
    after: { "src/X.ts": "", "src/X.vibe": "", "test/x.test.ts": forms[0].replace("X.ts", "X.vibe") }
  }).ok, false)
})
test("module rename plus assertion in a fixture is still forbidden", () => {
  const a = 'import "../src/X.ts"; expect(f()).toBe(1)'
  assert.equal(check("", "", {
    before: { "src/X.ts": "", "fixtures/sample.ts": a },
    after: { "src/X.vibe": "", "fixtures/sample.ts": a.replace("X.ts", "X.vibe") }
  }).ok, true)
  assert.equal(check("", "", {
    before: { "src/X.ts": "", "fixtures/sample.ts": a },
    after: { "src/X.vibe": "", "fixtures/sample.ts": a.replace("X.ts", "X.vibe").replace("toBe(1)", "toBe(2)") }
  }).ok, false)
})
// docs/design/src/900-appendices.md#7ea817327cbffaf5 — Chapter 900: selectors preserve equal names and counts.
test("property: widening selectors preserves exactly the original file identities", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("same", "add", "drop"), (names, operation) => {
      const a = 'const p = import.meta.glob("../src/**/*.ts")'
      const b = 'const p = import.meta.glob(["../src/**/*.{ts,vibe}", "!../src/**/*.d.vibe.ts"])'
      const before = { "test/x.test.ts": a }, after = { "test/x.test.ts": b }, renames = []
      for (const name of names) {
        before["src/" + name + ".ts"] = ""
        after["src/" + name + ".vibe"] = ""
        after["src/" + name + ".d.vibe.ts"] = ""
        renames.push({ from: "src/" + name + ".ts", to: "src/" + name + ".vibe" })
      }
      if (operation === "add") after["src/EXTRA.vibe"] = ""
      if (operation === "drop") delete after["src/" + names[0] + ".vibe"]
      assert.equal(check("", "", { before, after, renames }).ok, operation === "same")
    }), { numRuns: 150, seed: 27202 })
})
test("a named extension regex is checked against its actual readdir domain", () => {
  const a = 'const ext = /\\.ts$/; const files = readdirSync("../src").filter(name => ext.test(name))'
  const b = 'const ext = /\\.(ts|vibe)$/; const files = readdirSync("../src").filter(name => ext.test(name) && !name.endsWith(".d.vibe.ts"))'
  assert.equal(check(a, b).ok, true)
  assert.equal(check(a + '; expect(ext.test("x.vibe")).toBe(false)', b + '; expect(ext.test("x.vibe")).toBe(false)').ok, false)
})
test("mutable directory bindings and unknown selector calls cannot prove identity", () => {
  const a = 'let dir = "../src"; const files = readdirSync(dir).filter(name => name.endsWith(".ts"))'
  const b = 'let dir = "../src"; const files = readdirSync(dir).filter(name => (name.endsWith(".ts") || name.endsWith(".vibe")) && !name.endsWith(".d.vibe.ts"))'
  assert.equal(check(a, b).ok, false)
})
test("a rooted glob requires an explicit tool root rather than guessing", () => {
  const a = 'const p = import.meta.glob("/src/*.ts")'
  const b = 'const p = import.meta.glob(["/src/*.{ts,vibe}", "!/src/*.d.vibe.ts"])'
  assert.equal(check(a, b).ok, false)
  assert.equal(check(a, b, { globRoot: "." }).ok, true)
})
test("snapshots and testdata are fixtures even outside a tests directory", () => {
  for (const file of ["src/__snapshots__/sample.snap", "testdata/sample.json", "src/example.test.ts.snap", "src/probe.test.js"]) {
    assert.equal(check("", "", { before: { [file]: "const n = 1" }, after: { [file]: "const n = 2" } }).ok, false)
  }
})
test("a module specifier inside an ordinary filter is not a selector change", () => {
  const a = 'const z = xs.filter(n => require("../src/X.ts")(n))'
  const b = a.replace("X.ts", "X.vibe")
  assert.equal(check(a, b).ok, true)
  assert.equal(check(a, b.replace("(n))", "(n + 1))")).ok, false)
})
test("property: specifier permission never absorbs random fixture, config or setup edits", () => {
  fc.assert(fc.property(
    fc.array(fc.record({ allowed: fc.boolean(), value: fc.nat(9999), kind: fc.constantFrom("assertion", "fs", "config", "comment", "setup") }),
      { minLength: 1, maxLength: 10 }), entries => {
      const render = (e, i, after) => {
        const change = after && !e.allowed
        return [
          forms[i % forms.length].replace("X.ts", after ? "X.vibe" : "X.ts"),
          "expect(f()).toBe(" + (e.value + (change && e.kind === "assertion" ? 1 : 0)) + ")",
          'expect(readFileSync("../src/X.' + (change && e.kind === "fs" ? "vibe" : "ts") + '")).toBe("text")',
          'const config' + i + ' = { include: "*. ' + (change && e.kind === "config" ? "vibe" : "ts") + '" }',
          "// " + (change && e.kind === "comment" ? "changed" : "original"),
          "beforeEach(() => setup(" + (e.value + (change && e.kind === "setup" ? 1 : 0)) + "))"
        ].join("\n")
      }
      const a = entries.map((e, i) => render(e, i, false)).join("\n")
      const b = entries.map((e, i) => render(e, i, true)).join("\n")
      assert.equal(check(a, b).ok, entries.every(e => e.allowed))
    }), { numRuns: 250, seed: 27203 })
})
test("an absolute tool root cannot read live files and hide an added snapshot identity", () => {
  const physical = mkdtempSync(join(tmpdir(), "test-diff-live-root-"))
  try {
    mkdirSync(join(physical, "src"))
    writeFileSync(join(physical, "src/X.ts"), "")
    const a = 'const p = import.meta.glob("/src/*.ts")'
    const b = 'const p = import.meta.glob(["/src/*.{ts,vibe}", "!/src/*.d.vibe.ts"])'
    const result = check(a, b, { globRoot: physical,
      after: { "src/X.vibe": "", "src/extra.vibe": "", "test/x.test.ts": b } })
    assert.equal(result.ok, false)
    assert.ok(result.files[0].hunks.some(h => /globRoot must be repository-relative/.test(h.reason ?? "")))
    assert.equal(JSON.stringify(result).includes(physical), false, "do not publish an invalid host root in the proof")
  } finally { rmSync(physical, { recursive: true, force: true }) }
})
test("property: tool roots never escape the pre/post trees", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z]{1,8}$/),
    fc.constantFrom("/", "../", "../../", "C:/", "C:\\", "\\"),
    (name, prefix) => {
      const a = 'const p = import.meta.glob("/src/*.ts")'
      const b = 'const p = import.meta.glob(["/src/*.{ts,vibe}", "!/src/*.d.vibe.ts"])'
      assert.equal(check(a, b, { globRoot: prefix + name }).ok, false)
    }), { numRuns: 100, seed: 27204 })
})

test("async and generator filter callbacks cannot prove synchronous file selection", () => {
  const before = 'const files = readdirSync("../src").filter(name => name.endsWith(".ts"))'
  const expression = '(name.endsWith(".ts") || name.endsWith(".vibe")) && !name.endsWith(".d.vibe.ts")'
  for (const callback of [
    'async name => ' + expression,
    'async function (name) { return ' + expression + ' }',
    'function* (name) { return ' + expression + ' }',
    'async function* (name) { return ' + expression + ' }'
  ]) {
    const after = 'const files = readdirSync("../src").filter(' + callback + ')'
    assert.equal(check(before, after).ok, false, callback)
  }
})

test("property: filter proofs preserve the callback's synchronous boolean contract", () => {
  // Detail 272 requires the actual selected set, not a boolean approximation
  // of an async function's Promise or a generator's iterator.
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}$/), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("arrow", "function", "async-arrow", "async-function", "generator", "async-generator", "rest", "default"),
    (names, kind) => {
      const expression = '(name.endsWith(".ts") || name.endsWith(".vibe")) && !name.endsWith(".d.vibe.ts")'
      const callback = {
        arrow: 'name => ' + expression,
        function: 'function (name) { return ' + expression + ' }',
        "async-arrow": 'async name => ' + expression,
        "async-function": 'async function (name) { return ' + expression + ' }',
        generator: 'function* (name) { return ' + expression + ' }',
        "async-generator": 'async function* (name) { return ' + expression + ' }',
        rest: '(...name) => ' + expression,
        default: '(name = setup()) => ' + expression
      }[kind]
      const a = 'const files = readdirSync("../src").filter(name => name.endsWith(".ts"))'
      const b = 'const files = readdirSync("../src").filter(' + callback + ')'
      const before = { "test/x.test.ts": a, "src/README.md": "" }
      const after = { "test/x.test.ts": b, "src/README.md": "" }
      const renames = []
      for (const name of names) {
        before["src/" + name + ".ts"] = ""
        after["src/" + name + ".vibe"] = ""
        after["src/" + name + ".d.vibe.ts"] = ""
        renames.push({ from: "src/" + name + ".ts", to: "src/" + name + ".vibe" })
      }
      assert.equal(check("", "", { before, after, renames }).ok, ["arrow", "function"].includes(kind))
    }), { numRuns: 150, seed: 27205 })
})

test("the runtime filter oracle distinguishes promises and iterators from booleans", () => {
  const entries = ["X.vibe", "X.d.vibe.ts", "README.md"]
  const matches = name => (name.endsWith(".ts") || name.endsWith(".vibe")) && !name.endsWith(".d.vibe.ts")
  assert.deepEqual(entries.filter(matches), ["X.vibe"])
  for (const callback of [
    async name => matches(name),
    function* (name) { return matches(name) },
    async function* (name) { return matches(name) }
  ]) assert.deepEqual(entries.filter(callback), entries)
})

const fastGlob = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))("fast-glob")
const legacyGlob = { library: "fast-glob@3.3.3", sync: fastGlob.sync, options: {} }
const defaultTinyGlob = { library: "tinyglobby(default options)", sync: glob.sync, options: { expandDirectories: false } }

test("fast-glob extended patterns report actual selected names and reject additions", () => {
  const a = 'const p = import.meta.glob("../src/+(X|Y).ts")'
  const b = 'const p = import.meta.glob(["../src/+(X|Y).{ts,vibe}", "!../src/*.d.vibe.ts"])'
  for (const engine of [glob, legacyGlob, defaultTinyGlob]) {
    const allowed = check(a, b, { glob: engine })
    assert.equal(allowed.ok, true, JSON.stringify(allowed))
    assert.deepEqual(allowed.files[0].hunks[0].setCheck.before, engine.options.extglob === false ? [] : ["src/X"])
    const added = check(a, b, { glob: engine,
      after: { "src/X.vibe": "", "src/Y.vibe": "", "test/x.test.ts": b } })
    assert.equal(added.ok, engine.options.extglob === false, engine.library)
    assert.equal(added.files[0].hunks[0].setCheck.afterCount, engine.options.extglob === false ? 0 : 2)
  }
})

test("property: both Vite glob engines preserve extended-pattern file identities", () => {
  // Detail 272: selectors require "same count, same names", using the actual
  // repository tool's glob semantics. Unknown options must not disable matching.
  fc.assert(fc.property(
    fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { minLength: 2, maxLength: 7 }),
    fc.constantFrom("same", "add", "drop"), (names, operation) => {
      const before = {}, after = {}, renames = []
      for (const name of names.slice(0, -1)) {
        before["src/" + name + ".ts"] = ""
        after["src/" + name + ".vibe"] = ""
        after["src/" + name + ".d.vibe.ts"] = ""
        renames.push({ from: "src/" + name + ".ts", to: "src/" + name + ".vibe" })
      }
      if (operation === "add") after["src/" + names.at(-1) + ".vibe"] = ""
      if (operation === "drop") delete after["src/" + names[0] + ".vibe"]
      for (const engine of [glob, legacyGlob, defaultTinyGlob]) {
        const stem = "../src/" + (engine.options.extglob === false ? "{" + names.join(",") + "}" : "@(" + names.join("|") + ")")
        const a = 'const p = import.meta.glob("' + stem + '.ts")'
        const b = 'const p = import.meta.glob(["' + stem + '.{ts,vibe}", "!../src/*.d.vibe.ts"])'
        assert.equal(check("", "", { before: { ...before, "test/x.test.ts": a },
          after: { ...after, "test/x.test.ts": b }, renames, glob: engine }).ok, operation === "same", engine.library)
      }
    }), { numRuns: 100, seed: 27206 })
})

function viteMatcherFixture(t, flags) {
  const root = mkdtempSync(join(tmpdir(), "test-diff-vite-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const vite = join(root, "node_modules/vite")
  mkdirSync(join(vite, "dist/node/chunks"), { recursive: true })
  writeFileSync(join(vite, "package.json"), JSON.stringify({
    name: "vite", version: "0.0.0-verifier-fixture", dependencies: { "fast-glob": "^3.3.2" }
  }))
  // Minimized installed-tool shape. Parsing it never executes glob or options.
  writeFileSync(join(vite, "dist/node/chunks/glob.js"),
    'async function transformGlobImport() { const cwd = "."; return glob(globsResolved, { absolute: true, cwd, ' + flags + ' }) }')
  const compilerRequire = createRequire(new URL("../../../../packages/compiler/package.json", import.meta.url))
  symlinkSync(dirname(compilerRequire.resolve("fast-glob/package.json")), join(root, "node_modules/fast-glob"), "dir")
  return root
}

test("the installed Vite AST determines matcher flags instead of a version guess", t => {
  const a = 'const p = import.meta.glob("../src/+(X|Y).ts")'
  const b = 'const p = import.meta.glob(["../src/+(X|Y).{ts,vibe}", "!../src/*.d.vibe.ts"])'
  for (const flags of ["", "extglob: false", "extglob: true"]) {
    const engine = loadGlob([viteMatcherFixture(t, flags)], ts)
    const enabled = flags !== "extglob: false"
    const result = check(a, b, { glob: engine,
      after: { "src/X.vibe": "", "src/Y.vibe": "", "test/x.test.ts": b } })
    assert.equal(result.ok, !enabled)
    assert.equal(result.files[0].hunks[0].setCheck.beforeCount, enabled ? 1 : 0)
    assert.equal(result.files[0].hunks[0].setCheck.afterCount, enabled ? 2 : 0)
    assert.deepEqual(result.files[0].hunks[0].matcherOptions, engine.options)
  }
})

test("an unsupported dynamic Vite matcher flag cannot fall back to another tool", t => {
  for (const flags of ["extglob: readOption()", "dot: readOption()", "ignore: readOption()",
    "caseSensitiveMatch: readOption()", 'ignore: options.exhaustive ? [] : ["private/**"]']) {
    const root = viteMatcherFixture(t, flags)
    assert.throws(() => loadGlob([root, new URL("../../../../docs/tools/", import.meta.url).pathname], ts),
      /unsupported dynamic Vite glob option/, flags)
  }
  const bundled = viteMatcherFixture(t, "")
  writeFileSync(join(bundled, "node_modules/vite/package.json"), JSON.stringify({
    name: "vite", version: "6.0.0", dependencies: {}, devDependencies: { tinyglobby: "^0.2.10" }
  }))
  assert.throws(() => loadGlob([bundled, new URL("../../../../docs/tools/", import.meta.url).pathname], ts),
    /installed Vite has no supported glob engine/)
})

test("shadowed module loaders cannot disguise a test edit", () => {
  for (const prefix of [
    'function require(p) { return p.endsWith(".ts") };',
    'const require = p => p.endsWith(".ts");',
    'const vi = { mock: p => p.endsWith(".ts") };',
    'const jest = { mock: p => p.endsWith(".ts") };',
    'require = p => p.endsWith(".ts");',
    'vi.mock = p => p.endsWith(".ts");'
  ]) {
    const call = prefix.includes("const vi") || prefix.startsWith("vi.mock") ? "vi.mock" : prefix.includes("const jest") ? "jest.mock" : "require"
    const a = prefix + call + '("../src/X.ts")'
    assert.equal(check(a, a.replace("X.ts", "X.vibe")).ok, false)
  }
  fc.assert(fc.property(fc.constantFrom("require", "vi", "jest"), fc.integer(), (name, n) => {
    const call = name === "require" ? name : name + ".mock"
    const a = 'function test(' + name + ') { return ' + call + '("../src/X.ts") } // ' + n
    assert.equal(check(a, a.replace("X.ts", "X.vibe")).ok, false)
  }), { numRuns: 100, seed: 27219 })
})
test("shadowed directory bindings and readers cannot prove selector identity", () => {
  for (const a of [
    'const dir = "../src"; function run(dir) { return readdirSync(dir).filter(f => f.endsWith(".ts")) }',
    'function readdirSync(p) { return ["X.d.vibe.ts"] }; const xs = readdirSync("../src").filter(f => f.endsWith(".ts"))',
    'const fs = { readdirSync: () => ["X.d.vibe.ts"] }; const xs = fs.readdirSync("../src").filter(f => f.endsWith(".ts"))'
  ]) {
    const b = a.replace('f.endsWith(".ts")', '(f.endsWith(".ts") || f.endsWith(".vibe")) && !f.endsWith(".d.vibe.ts")')
    assert.equal(check(a, b).ok, false)
  }
})
test("standard imported mock and directory functions retain their roles", () => {
  for (const prefix of ['import { vi } from "vitest";', 'import { jest } from "@jest/globals";']) {
    const name = prefix.includes("vitest") ? "vi" : "jest"
    const a = prefix + name + '.mock("../src/X.ts")'
    assert.equal(check(a, a.replace("X.ts", "X.vibe")).ok, true)
  }
  const a = 'import { readdirSync } from "node:fs"; const xs = readdirSync("../src").filter(f => f.endsWith(".ts"))'
  const b = a.replace('f.endsWith(".ts")', '(f.endsWith(".ts") || f.endsWith(".vibe")) && !f.endsWith(".d.vibe.ts")')
  assert.equal(check(a, b).ok, true)
})

test("a test-project bridge setup wrote is its own addition only with the bytes setup wrote", () => {
  const scratch = mkdtempSync(join(tmpdir(), "test-diff-bridge-"))
  const text = JSON.stringify({ extends: "../tsconfig.test.json" }, null, 2) + "\n"
  const diff = (after, bridges) => verifyTestDiff({ ts, before: { "test/a.test.ts": "it(\"a\", () => {})\n" },
    after: { "test/a.test.ts": "it(\"a\", () => {})\n", ...after }, renames: [], bridges, scratch })
  try {
    const bridges = [{ config: "test/tsconfig.json", text }]
    assert.equal(diff({ "test/tsconfig.json": text }, bridges).ok, true)
    assert.equal(diff({ "test/tsconfig.json": text }, []).ok, false, "an unrecorded config is a test edit")
    assert.equal(diff({ "test/tsconfig.json": text.replace("test.json", "json") }, bridges).ok, false, "a bridge edited after setup is a test edit")
    assert.equal(diff({ "test/tsconfig.json": text, "test/b.test.ts": "it(\"b\", () => {})\n" }, bridges).ok, false, "a bridge never excuses an added test")
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})

// Chapter 900: extensionless module paths retain their spelling and identity.
// docs/design/src/900-appendices.md#0c441992a918924a — Chapter 900: an extensionless specifier needs no edit.
test("an extensionless import stays unchanged across the module rename", () => {
  const source = 'import { f } from "../src/X"; expect(f()).toBe(1)'
  assert.equal(check(source, source).ok, true)
  assert.equal(check(source, source.replace("../src/X", "../src/X.vibe")).ok, false)
})
