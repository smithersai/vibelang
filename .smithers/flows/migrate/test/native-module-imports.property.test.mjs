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
const saved = JSON.parse(readFileSync(new URL("./corpus/smithers-native-body-source-import.json", import.meta.url), "utf8"))
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
const admission = JSON.parse(readFileSync(new URL("./corpus/opencode-native-source-extension-admission.json", import.meta.url), "utf8"))
const tooling = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
test("source-extension admission follows the native twin", () => {
  assert.ok(tooling.includes("Written `./x.vibe` and `./x.vibex` imports follow the `.ts`/`.tsx` twin's source-extension checks"))
})
function check({ resolution, allow, rewrite: rewriteExtensions = false, kind, body, quote: q = "\"", inline = false }) {
  const root = mkdtempSync(join(tmpdir(), "native-import-"))
  const form = kinds[kind]("./leaf.js").replaceAll("\"", q)
  const source = body ? `module local {${inline ? " " : "\n"}${form}\n}\n` : form + "\n"
  const expected = body ? source : source.replace("./leaf.js", "./leaf.vibe")
  const options = { strict: true, target: "ESNext", module: ["NodeNext", "Node16"].includes(resolution) ? resolution : "ESNext",
    moduleResolution: resolution, types: [], noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: allow, rewriteRelativeImportExtensions: rewriteExtensions }
  try {
    writeFileSync(join(root, "package.json"), "{\"type\":\"module\"}")
    writeFileSync(join(root, "leaf.vibe"), fixture.leaf)
    writeFileSync(join(root, "main.vibe"), rewrite(source))
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), expected)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, vibe: { effectModules: false }, files: ["main.vibe", "leaf.vibe"] }))
    const compiled = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.ifError(compiled.error)
    // Compare the actual rewritten import, including its source extension,
    // against stock TypeScript. Type-only imports need no extension opt-in.
    writeFileSync(join(root, "leaf.ts"), fixture.leaf)
    const twin = body ? form : expected.replaceAll("./leaf.vibe", "./leaf.ts")
    const twinPath = join(root, "twin.ts")
    writeFileSync(twinPath, twin)
    const parsed = ts.convertCompilerOptionsFromJson(options, root)
    assert.deepEqual(parsed.errors, [])
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([twinPath], parsed.options))
    const native = diagnostics.map(d => {
      assert.equal(d.file?.fileName, twinPath)
      const position = d.file.getLineAndCharacterOfPosition(d.start)
      return {
        code: "TS" + d.code, line: position.line + 1, column: position.character + 1,
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
      }
    })
    const actual = [...compiled.stdout.matchAll(/^main\.vibe\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)].map(m => ({
      code: m[3], line: Number(m[1]), column: Number(m[2]),
      message: m[4].replaceAll("'.vibe'", "'.ts'"),
    }))
    const context = JSON.stringify({ resolution, allow, rewrite: rewriteExtensions, kind, body }) + "\n" + compiled.stdout + compiled.stderr
    assert.equal(compiled.status, native.length ? 2 : 0, context)
    assert.equal(compiled.stderr, "", context)
    assert.equal(actual.length, (compiled.stdout.match(/: error /g) || []).length, context)
    assert.deepEqual(actual, native, context)
    return native.map(d => Number(d.code.slice(2)))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test(admission.key, () => {
  assert.deepEqual(check(admission), admission.codes)
})

test("module resolution, source-extension option, import kind and position matrix", () => {
  for (const resolution of resolutions) for (const allow of [false, true]) for (const rewrite of [false, true])
    for (const kind of Object.keys(kinds)) for (const body of [false, true]) check({ resolution, allow, rewrite, kind, body })
})
test("native import neighbours vary quotes, layout, resolver, option and form", () => {
  fc.assert(fc.property(fc.record({ resolution: fc.constantFrom(...resolutions), allow: fc.boolean(), rewrite: fc.boolean(),
    kind: fc.constantFrom(...Object.keys(kinds)), body: fc.boolean(), quote: fc.constantFrom("\"", "\u0027"), inline: fc.boolean() }), sample => { check(sample) }),
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

test("native bodies retain JavaScript extensions, extensionless names and aliases under project rewrite policy", () => {
  for (const specifier of ["./leaf.js", "./leaf", "@/leaf"]) {
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

// A body is a TypeScript file, so a name of the moved source file follows the rename as it does in a sibling .ts file.
function compileBody({ allow = true, kind, spelled }) {
  const root = mkdtempSync(join(tmpdir(), "native-import-"))
  const options = { strict: true, target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: allow }
  try {
    writeFileSync(join(root, "package.json"), "{\"type\":\"module\"}")
    writeFileSync(join(root, "leaf.vibe"), fixture.leaf)
    writeFileSync(join(root, "main.vibe"), "module local {\n" + kinds[kind](spelled) + "\n}\n")
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, vibe: { effectModules: false }, files: ["main.vibe", "leaf.vibe"] }))
    const compiled = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.ifError(compiled.error)
    return compiled
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a body's name of a renamed source file follows the rename and compiles", () => {
  for (const kind of Object.keys(kinds)) {
    const before = "module local {\n" + kinds[kind]("./leaf.ts") + "\n}\n", after = rewrite(before)
    assert.equal(after, before.replace("./leaf.ts", "./leaf.vibe"))
    assert.match(compileBody({ kind, spelled: "./leaf.ts" }).stdout, /TS2307/, kind)
    const compiled = compileBody({ kind, spelled: "./leaf.vibe" })
    assert.equal(compiled.status, 0, kind + compiled.stdout + compiled.stderr)
  }
})

test(saved.key, () => {
  const files = new Map([[saved.importer, saved.before], [saved.moved, fixture.leaf]])
  rewriteImports("/virtual", [...files.keys()], [saved.moved], undefined, { read: file => files.get(file), write: (file, text) => files.set(file, text) })
  assert.equal(files.get(saved.importer), saved.after)
})

test("a revert returns a body's source name, and a module that stayed TypeScript keeps it", () => {
  const body = spec => "module local {\nimport { value } from " + JSON.stringify(spec) + ";\nexport const result = value;\n}\n"
  const files = new Map([["main.vibe", body("./leaf.vibe")], ["leaf.ts", fixture.leaf], ["other.ts", fixture.leaf]])
  const io = { read: file => files.get(file), write: (file, text) => files.set(file, text) }
  rewriteImports("/virtual", [...files.keys()], ["leaf.ts"], undefined, io)
  assert.equal(files.get("main.vibe"), body("./leaf.ts"))
  files.set("main.vibe", body("./other.ts"))
  assert.deepEqual(rewriteImports("/virtual", [...files.keys()], ["leaf.ts"], undefined, io), [])
})

test("a body's source names change only in the body's own import forms", () => {
  fc.assert(fc.property(fc.constantFrom(...Object.keys(kinds)), fc.constantFrom("\"", "\u0027"), fc.boolean(), fc.constantFrom("", "// ./leaf.ts\n", "const text = \"./leaf.ts\";\n"), (kind, q, inline, noise) => {
    const form = kinds[kind]("./leaf.ts").replaceAll("\"", q)
    const source = "module local {" + (inline ? " " : "\n") + noise + form + "\n}\n"
    assert.equal(rewrite(source), "module local {" + (inline ? " " : "\n") + noise + form.replace("./leaf.ts", "./leaf.vibe") + "\n}\n")
  }), { seed: 405099, numRuns: 120, endOnFailure: true })
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
