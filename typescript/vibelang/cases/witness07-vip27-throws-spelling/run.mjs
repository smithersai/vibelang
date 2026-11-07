// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

// The shipped table: one annotation per member of JavaScript's globals.
const table = readFileSync(new URL("../../../tsc/internal/vibelang/globalthrows_table.go", import.meta.url), "utf8")
const shipped = [...table.matchAll(/^\t"([^"]+)":\s+"([^"]+)",$/gm)].map(m => ({ key: m[1], throws: m[2] }))
assert.ok(shipped.length > 500, "globalThrowsTable read")
const values = [...new Set(shipped.map(x => x.throws))].sort()
assert.ok(values.includes("never") && values.includes("SyntaxError") && values.includes("unknown"), values.join())

// Each value is the type of a JSDoc @throws {T} tag, spelled as TypeScript
// prints it, and names only global classes the ES and DOM libs declare.
const probe = values.map((v, i) => `/** @throws {${v}} */\nexport declare function f${i}(): void\nexport type T${i} = ${v}`).join("\n")
const dir = mkdtempSync(join(tmpdir(), "witness07-throws-spelling-"))
try {
  writeFileSync(join(dir, "package.json"), "{\"type\":\"module\"}")
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
  const file = join(dir, "probe.ts")
  writeFileSync(file, probe)
  const program = ts.createProgram([file], { noEmit: true, strict: true, types: [], lib: ["lib.esnext.d.ts", "lib.dom.d.ts"], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  const source = program.getSourceFile(file)
  const tags = source.statements.filter(ts.isFunctionDeclaration).map(fn => ts.getJSDocTags(fn).find(t => t.tagName.text === "throws"))
  assert.deepEqual(tags.map(t => t?.typeExpression?.type.getText(source)), values, "each value is a well-formed @throws type")

  // A global and a .ts declaration carrying its shipped annotation compile to
  // the same diagnostics, in plain and effect code.
  const run = text => {
    writeFileSync(join(dir, "main.vibe"), text)
    const r = spawnSync(process.env.VIBELANG_BINARY, ["--pretty", "false", "--noEmit", "--strict", "--types", "", "--module", "nodenext", "--target", "es2022", "--lib", "esnext,dom", join(dir, "main.vibe")], { cwd: dir, encoding: "utf8", timeout: 60000 })
    return [...(r.stdout + r.stderr).matchAll(/error ((?:TS|EK)\d+):/g)].map(m => m[1])
  }
  for (const [key, call] of [["JSON.parse", "JSON.parse(s)"], ["decodeURI", "decodeURI(s)"], ["Math.max", "Math.max(s.length, 1)"]]) {
    const throws = shipped.find(x => x.key === key).throws
    writeFileSync(join(dir, "wrapped.d.ts"), `/** @throws {${throws}} */\nexport declare function wrapped(s: string): any\n`)
    const body = c => `export function plain(s: string) { return ${c} }\nexport effect function eff(s: string) { return ${c} }\n`
    const global = run(body(call))
    const written = run("import { wrapped } from \"./wrapped.js\"\n" + body("wrapped(s)"))
    assert.deepEqual(global, written, key + " @throws {" + throws + "}")
    assert.deepEqual(global, throws === "never" ? [] : ["EK0401", "EK0403"], key)
  }
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("shipped global annotations are @throws {T} types with their written meaning")
