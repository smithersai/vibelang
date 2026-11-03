import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addRuntimeImport, wireNodeTests } from "../lib/node-tests.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const register = "vibelang/register"
const specsFor = () => ({ vibelang: "file:.vibelang-toolchain/vibelang.tgz" })

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-node-tests-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n")
  }
  return root
}
const read = (root, file) => readFileSync(join(root, file), "utf8")

// Smithers (TOOLS.md 08:46Z, ci-repository): .smithers/flows declares
// `Smithers.Runtime.Node({ version: ">=26.4.0" })`, and its NodeTest targets
// codingHostSize, egress and repository run `node --test` under it. Once
// flows/jj's JjInternalFault and coding/landing-schema were .vibe, each failed
// with ERR_UNKNOWN_FILE_EXTENSION ".vibe". The runtime's `imports` field is
// Smithers' own seam for vibelang/register (build/targets Runtime.ts).
const smithers = {
  "package.json": { name: "smithers-monorepo", private: true, workspaces: ["packages/*", ".smithers/flows"] },
  "packages/jj/package.json": { name: "@smthrs/jj", version: "0.0.0" },
  "packages/jj/src/JjInternalFault.vibe": "export const fault = 1\n",
  ".smithers/flows/package.json": { name: "@smithers/release-workflows", private: true, dependencies: { "@smthrs/jj": "workspace:*" } },
  ".smithers/flows/PACKAGE.ts": [
    "import { Smithers } from \"@smthrs/targets\"",
    "",
    "const node = Smithers.Runtime.Node({ version: \">=26.4.0\" })",
    "const bun = Smithers.Runtime.Bun({ version: \">=1.4.0\" })",
    "",
    "const egress = Smithers.NodeTest({",
    "  runtime: node,",
    "  runner: Smithers.testRunner([Smithers.file(\"//.smithers/flows/test/repository-jev-egress.test.ts\")]),",
    "  srcs: [],",
    "  deps: []",
    "})",
    ""
  ].join("\n"),
  // A build-cli test fixture is a test's input: setup never edits it.
  "packages/build-cli/package.json": { name: "@smthrs/build-cli", dependencies: { "@smthrs/jj": "workspace:*" } },
  "packages/build-cli/test/fixtures/target-body/PACKAGE.ts": "const runtime = S.Runtime.Node({ version: \">=26.4.0\" })\n",
  // A package that reaches no migrated source keeps its runtime as written.
  "packages/other/package.json": { name: "@smthrs/other" },
  "packages/other/PACKAGE.ts": "const node = Smithers.Runtime.Node({ version: \">=26.4.0\" })\n",
  // node --test in a package script that reaches migrated sources.
  "packages/cli/package.json": { name: "@smthrs/cli", dependencies: { "@smthrs/jj": "workspace:*" }, devDependencies: { vibelang: "0.0.11" }, scripts: { test: "node --test test/*.test.ts", lint: "eslint ." } }
}

test("corpus: Smithers' Node runtime and node --test scripts that reach migrated sources load vibelang/register", (t) => {
  const root = repo(t, smithers)
  const fixture = read(root, "packages/build-cli/test/fixtures/target-body/PACKAGE.ts")
  const other = read(root, "packages/other/PACKAGE.ts")
  const result = wireNodeTests({ root, packages: [{ dir: "packages/jj" }], ts, specsFor })
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.changed.sort(), [".smithers/flows/PACKAGE.ts", ".smithers/flows/package.json", "packages/cli/package.json"])
  assert.match(read(root, ".smithers/flows/PACKAGE.ts"), /const node = Smithers\.Runtime\.Node\(\{ version: ">=26\.4\.0", imports: \["vibelang\/register"\] \}\)/)
  assert.match(read(root, ".smithers/flows/PACKAGE.ts"), /const bun = Smithers\.Runtime\.Bun\(\{ version: ">=1\.4\.0" \}\)/)
  assert.equal(JSON.parse(read(root, ".smithers/flows/package.json")).devDependencies.vibelang, specsFor().vibelang)
  const cli = JSON.parse(read(root, "packages/cli/package.json"))
  assert.equal(cli.scripts.test, 'NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" node --test test/*.test.ts')
  assert.equal(cli.scripts.lint, "eslint .")
  assert.equal(cli.devDependencies.vibelang, "0.0.11", "an existing compiler dependency stays")
  assert.equal(read(root, "packages/build-cli/test/fixtures/target-body/PACKAGE.ts"), fixture)
  assert.equal(read(root, "packages/other/PACKAGE.ts"), other)
  assert.deepEqual(wireNodeTests({ root, packages: [{ dir: "packages/jj" }], ts, specsFor }).changed, [], "a second setup changes nothing")
})

test("addRuntimeImport appends to an existing imports list, keeps one that loads it, and refuses a non-literal declaration", () => {
  const one = (text) => addRuntimeImport(text, ts)
  assert.equal(one('const n = Runtime.Node({ version: "26", imports: ["./hooks.mjs"] })\n').text, 'const n = Runtime.Node({ version: "26", imports: ["./hooks.mjs", "vibelang/register"] })\n')
  assert.equal(one('const n = Runtime.Node({ version: "26", imports: [] })\n').text, 'const n = Runtime.Node({ version: "26", imports: ["vibelang/register"] })\n')
  const kept = 'const n = Runtime.Node({ version: "26", imports: ["vibelang/register"] })\n'
  assert.equal(one(kept).text, kept)
  assert.equal(one("const n = Runtime.Node({})\n").text, 'const n = Runtime.Node({ imports: ["vibelang/register"] })\n')
  assert.equal(one("const n = Smithers.Runtime.Node({\n  version: \"26\",\n})\n").text, "const n = Smithers.Runtime.Node({\n  version: \"26\",\n  imports: [\"vibelang/register\"],\n})\n")
  const shared = one("const n = Runtime.Node(options)\nconst m = Runtime.Node({ version: \"26\", imports: list })\n")
  assert.equal(shared.text, "const n = Runtime.Node(options)\nconst m = Runtime.Node({ version: \"26\", imports: list })\n")
  assert.deepEqual(shared.refusals.map((r) => r.line), [1, 2])
  assert.equal(one('const b = Runtime.Bun({ version: "1" })\n').text, 'const b = Runtime.Bun({ version: "1" })\n')
})

test("property: every literal Node runtime loads vibelang/register once, last, keeps its other fields and imports, and still parses", () => {
  const field = fc.constantFrom('version: ">=26.4.0"', 'executable: "node26"', 'version: "latest"')
  const importList = fc.option(fc.uniqueArray(fc.constantFrom('"./hooks.mjs"', '"tsx"', '"vibelang/register"', "'./a.mjs'"), { maxLength: 3 }), { nil: undefined })
  const arb = fc.record({
    fields: fc.uniqueArray(field, { maxLength: 2, selector: (f) => f.split(":")[0] }),
    imports: importList,
    multiline: fc.boolean(),
    trailing: fc.boolean(),
    callee: fc.constantFrom("Runtime.Node", "Smithers.Runtime.Node", "S.Runtime.Node")
  })
  fc.assert(fc.property(fc.array(arb, { minLength: 1, maxLength: 3 }), (decls) => {
    const objects = decls.map(({ fields, imports, multiline, trailing }) => {
      const props = [...fields, ...(imports === undefined ? [] : [`imports: [${imports.join(", ")}]`])]
      if (!props.length) return "{}"
      return multiline ? `{\n  ${props.join(",\n  ")}${trailing ? "," : ""}\n}` : `{ ${props.join(", ")}${trailing ? "," : ""} }`
    })
    const text = decls.map((d, i) => `const r${i} = ${d.callee}(${objects[i]})\n`).join("")
    const once = addRuntimeImport(text, ts)
    assert.deepEqual(once.refusals, [])
    assert.equal(addRuntimeImport(once.text, ts).text, once.text, "idempotent")
    const source = ts.createSourceFile("PACKAGE.ts", once.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    assert.equal(source.parseDiagnostics.length, 0, once.text)
    const calls = []
    const visit = (node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit) }
    visit(source)
    assert.equal(calls.length, decls.length)
    calls.forEach((call, i) => {
      const object = call.arguments[0]
      const props = Object.fromEntries(object.properties.map((p) => [p.name.text, p.initializer]))
      for (const f of decls[i].fields) assert.equal(props[f.split(":")[0]].text, JSON.parse(f.split(": ")[1]))
      const list = props.imports.elements.map((e) => e.text)
      const before = (decls[i].imports ?? []).map((s) => s.slice(1, -1))
      assert.equal(list.filter((s) => s === register).length, 1, once.text)
      assert.deepEqual(list.filter((s) => s !== register), before.filter((s) => s !== register))
      if (!before.includes(register)) assert.equal(list.at(-1), register)
    })
  }), { numRuns: 400 })
})

test("setup wires Smithers' .smithers/flows Node runtime through wireTarget", async (t) => {
  const { symlinkSync, mkdirSync: mk } = await import("node:fs")
  const { must } = await import("../lib/util.mjs")
  const { makeConfig, wireTarget } = await import("../lib/steps.mjs")
  const root = repo(t, {
    "package.json": { name: "fixture", private: true, workspaces: ["packages/core"] },
    "packages/core/package.json": { name: "core", type: "module" },
    "packages/core/tsconfig.json": { compilerOptions: { strict: true }, include: ["src/**/*.ts"] },
    "packages/core/src/index.ts": "export const one = 1\n",
    ".smithers/flows/package.json": { name: "flows", private: true, dependencies: { core: "workspace:*" } },
    ".smithers/flows/PACKAGE.ts": smithers[".smithers/flows/PACKAGE.ts"]
  })
  mk(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj file track . 2>/dev/null; true", { cwd: root })
  const config = makeConfig({ target: root, packages: ["packages/core"], test: "true", vibelangVersion: "0.0.11", install: "true" })
  const wired = await wireTarget(config, join(root, ".logs"))
  assert.ok(wired.changed.includes(".smithers/flows/PACKAGE.ts"), wired.changed.join("\n"))
  assert.match(read(root, ".smithers/flows/PACKAGE.ts"), /Runtime\.Node\(\{ version: ">=26\.4\.0", imports: \["vibelang\/register"\] \}\)/)
})
