import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { rewriteImports } from "../lib/codemod.mjs"
import { splitPlatformToModule } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const fixture = JSON.parse(readFileSync(new URL("./corpus/opencode-native-module-import.json", import.meta.url), "utf8"))
const vip = readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8")
const quote = "A body is a TypeScript file stored inside a `.vibe` file."

test("native import spelling follows VIP-40", () => assert.ok(vip.includes(quote)))

function rewrite(source) {
  const files = new Map([["main.vibe", source], ["leaf.vibe", fixture.leaf]])
  rewriteImports("/virtual", [...files.keys()], ["leaf.vibe"], undefined, {
    read: file => files.get(file), write: (file, text) => files.set(file, text),
  })
  return files.get("main.vibe")
}

test(fixture.key, () => assert.equal(rewrite(fixture.source), fixture.source))

test("the splitter and rewriter preserve the imported throwing helper dependency", () => {
  const split = splitPlatformToModule(fixture.before, "main.ts", ts, { throws: true })
  assert.ok(split && !split.refused)
  assert.match(split.module, /module throwing/)
  assert.equal(rewrite(split.module), split.module)
})

const kinds = {
  named: spec => `import { value } from "${spec}";\nexport const result = value;`,
  namespace: spec => `import * as leaf from "${spec}";\nexport const result = leaf.value;`,
  type: spec => `import type { Shape } from "${spec}";\nexport type Result = Shape;`,
  reexport: spec => `export { value as result } from "${spec}";`,
}
const resolutions = ["NodeNext", "Node16", "Bundler"]
function check({ resolution, allow, kind, body, quote: q = "\"", inline = false }) {
  const root = mkdtempSync(join(tmpdir(), "native-import-"))
  const form = kinds[kind]("./leaf.js").replaceAll("\"", q)
  const source = body ? `module local {${inline ? " " : "\n"}${form}\n}\n` : form + "\n"
  const expected = body ? source : source.replace("./leaf.js", "./leaf.vibe")
  const options = { strict: true, target: "ESNext", module: ["NodeNext", "Node16"].includes(resolution) ? resolution : "ESNext",
    moduleResolution: resolution, types: [], noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: allow }
  try {
    writeFileSync(join(root, "package.json"), "{\"type\":\"module\"}")
    writeFileSync(join(root, "leaf.vibe"), fixture.leaf)
    writeFileSync(join(root, "main.vibe"), rewrite(source))
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), expected)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, vibe: { effectModules: false }, files: ["main.vibe", "leaf.vibe"] }))
    const compiled = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.ifError(compiled.error)
    assert.equal(compiled.status, 0, JSON.stringify({ resolution, allow, kind, body }) + compiled.stdout + compiled.stderr)
    // The unchanged native body must also compile as a real TypeScript file.
    writeFileSync(join(root, "leaf.ts"), fixture.leaf)
    writeFileSync(join(root, "twin.ts"), form)
    const parsed = ts.convertCompilerOptionsFromJson(options, root)
    assert.deepEqual(parsed.errors, [])
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([join(root, "twin.ts")], parsed.options))
    assert.deepEqual(diagnostics.map(d => [d.code, ts.flattenDiagnosticMessageText(d.messageText, "\n")]), [])
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("module resolution, source-extension option, import kind and position matrix", () => {
  for (const resolution of resolutions) for (const allow of [false, true])
    for (const kind of Object.keys(kinds)) for (const body of [false, true]) check({ resolution, allow, kind, body })
})
test("native import neighbours vary quotes, layout, resolver, option and form", () => {
  fc.assert(fc.property(fc.record({ resolution: fc.constantFrom(...resolutions), allow: fc.boolean(),
    kind: fc.constantFrom(...Object.keys(kinds)), body: fc.boolean(), quote: fc.constantFrom("\"", "\u0027"), inline: fc.boolean() }), check),
    { seed: 405097, numRuns: 40, endOnFailure: true })
})

test("native boundaries keep comments, strings, nested braces and neighbouring top-level imports distinct", () => {
  const body = `module local {\nconst text = "} module fake {";\nconst pattern = /[{}]/;\nconst template = \`brace } \${{ value: 1 }.value}\`;\n/* } */\nimport { value } from "./leaf.js";\nexport function f() { if (value) { return { value }; } }\n}\n`
  const top = `import { value } from "./leaf.js";\n`
  for (const prefix of ["", "schema Example { value: string }\n", "effect function f() { return try succeed(1) }\n", "export const marker = do { 1; }\n"]) {
    assert.equal(rewrite(prefix + body + top), prefix + body + top.replace("./leaf.js", "./leaf.vibe"))
  }
  assert.equal(rewrite(`// module fake {\n` + top), `// module fake {\n` + top.replace("./leaf.js", "./leaf.vibe"))
})

test("native bodies retain source extensions, extensionless names and aliases under project rewrite policy", () => {
  for (const specifier of ["./leaf.js", "./leaf.ts", "./leaf", "@/leaf"]) {
    for (const module of ["module local", "module/* boundary */local"]) {
      const source = module + " {\nimport { value } from " + JSON.stringify(specifier) + ";\nexport const result = value;\n}\n"
      const files = new Map([["main.vibe", source], ["leaf.vibe", fixture.leaf]])
      const aliases = () => [{ pattern: "@/*", targets: ["*"] }]
      aliases.rewriteRelativeImportExtensions = () => true
      aliases.migratedSourceExtension = () => ".vibe"
      assert.deepEqual(rewriteImports("/virtual", [...files.keys()], ["leaf.vibe"], aliases, {
        read: file => files.get(file), write: (file, text) => files.set(file, text),
      }), [])
      assert.equal(files.get("main.vibe"), source)
    }
  }
})

test("native boundaries survive surrounding VibeLang forms and misleading literal tokens", () => {
  fc.assert(fc.property(fc.constantFrom(
    "export const marker = do { 1; }", "data Marker { Empty; Full { value: number } }",
    "schema Marker { value: number }", "service Marker { read(): number!Error }",
    "export const marker = effect { return 1 }", "error Marker { value: number }",
    'const marker = "module fake {"', "const marker = /module fake \{/"),
    fc.constantFrom("\n", "\n\n", ";\n"), (prefix, separator) => {
      const body = 'module local {\nimport { value } from "./leaf.js";\nexport const result = value;\n}\n'
      const top = 'import { value } from "./leaf.js";\n'
      assert.equal(rewrite(prefix + separator + body + top), prefix + separator + body + top.replace("./leaf.js", "./leaf.vibe"))
    }), { seed: 405098, numRuns: 120, endOnFailure: true })
})

test("ordinary namespaces and contextual module bindings keep the VibeLang import policy", () => {
  for (const source of [
    '// module is only prose\nnamespace local { export const result = import("./leaf.js"); }\n',
    'service module { value: typeof import("./leaf.js").value }\n',
  ]) assert.equal(rewrite(source), source.replace("./leaf.js", "./leaf.vibe"))
})
