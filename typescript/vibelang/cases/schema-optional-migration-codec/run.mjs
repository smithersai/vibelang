// run-seconds: 270
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
const root = path.join(here, ".cache", "optional-codec-" + process.pid)
fs.mkdirSync(root, { recursive: true })
const prefix = 'import * as Schema from "effect/Schema"\n'
const variants = [
{
  "name": "smithers-retry-policy",
  "source": "schema Fields { readonly maxAttempts?: number; readonly retryable?: readonly { readonly tag: string; readonly code?: string }[] }\nexport const E = Fields.check(Schema.makeFilter(() => true)); export type E = typeof E.Type;",
  "twin": "const Fields = Schema.Struct({ maxAttempts: Schema.optional(Schema.Number), retryable: Schema.optional(Schema.Array(Schema.Struct({ tag: Schema.String, code: Schema.optional(Schema.String) }))) }); type Fields = typeof Fields.Type;\nexport const E = Fields.check(Schema.makeFilter(() => true)); export type E = typeof E.Type;",
  "observe": "return [accepts(E,{}),accepts(E,{retryable:[{tag:\"a\",code:undefined}]}),accepts(E,{retryable:[{tag:\"a\",code:null}]})];",
  "expected": [
    true,
    true,
    false
  ]
},
  {
    name: "smithers-jev-session-checker",
    prefix: 'import { Schema } from "effect"\n',
    source: 'export schema error E { status?: number; get label() { return "kept" } }',
    twin: 'export class E extends Schema.TaggedError<E>()("E", { status: Schema.optional(Schema.Number) }) { get label() { return "kept" } }',
    observe: 'const subject = {_tag:"E",status:1}; const matcher=E[Symbol.customMatcher ?? Symbol.for("Symbol.customMatcher")]; return [new E({status:1}).label, matcher.call(E,subject,{matchType:"extractor"})?.[0]===subject];',
    expected: ["kept", true]
  },
  {
    name: "t3code-safari-cookies",
    source: 'export schema E { readonly value?: string }',
    twin: 'export const E = Schema.Struct({ value: Schema.optional(Schema.String) }); export type E = typeof E.Type;',
    observe: 'return [accepts(E,{}),accepts(E,{value:undefined}),accepts(E,{value:null})];',
    expected: [true, true, false]
  },
  {
    name: "nested-optional-tuple",
    source: 'export schema E { readonly values: readonly [number?] }',
    twin: 'export const E = Schema.Struct({ values: Schema.Tuple([Schema.optional(Schema.Number)]) }); export type E = typeof E.Type;',
    observe: 'return [accepts(E,{values:[]}),accepts(E,{values:[undefined]}),accepts(E,{values:[null]})];',
    expected: [true, true, false]
  }
]
for (const row of variants) {
  const dir = path.join(root, row.name)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n')
  fs.writeFileSync(path.join(dir, "main.vibe"), (row.prefix ?? prefix) + row.source + "\n")
  fs.writeFileSync(path.join(dir, "twin.ts"), (row.prefix ?? prefix) + row.twin + "\n")
  const options = { target: "es2022", module: "nodenext", strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, types: [], declaration: true, noEmitOnError: true, outDir: "out" }
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["main.vibe"] }))
  fs.writeFileSync(path.join(dir, "twin.json"), JSON.stringify({ compilerOptions: { ...options, outDir: "stock" }, files: ["twin.ts"] }))
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 60000 })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result
  }
  run(process.execPath, [tsc, "-p", path.join(dir, "twin.json"), "--pretty", "false"])
  run(compiler, ["-p", dir, "--fix", "--fix-migration-only", "--pretty", "false"])
  const declaration = fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8")
  const twin = fs.readFileSync(path.join(dir, "stock/twin.d.ts"), "utf8")
  assert.equal(declaration, twin, row.name + ": published codec changed")
  const text = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
  run(compiler, ["-p", dir, "--fix", "--fix-migration-only", "--pretty", "false"])
  assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), text, "upgrade must be idempotent")
  const script = 'import * as Schema from "effect/Schema";\nimport { E } from "./out/main.js";\n' +
    'const accepts=(codec,value)=>{try{Schema.decodeUnknownSync(codec)(value);return true}catch{return false}};\n' +
    'const observe=()=>{' + row.observe + '};\n' +
    'if(JSON.stringify(observe())!==' + JSON.stringify(JSON.stringify(row.expected)) + ') throw new Error(JSON.stringify(observe()));\n'
  fs.writeFileSync(path.join(dir, "observe.mjs"), script)
  run(process.execPath, [path.join(dir, "observe.mjs")])
}
fs.rmSync(root, { recursive: true })
console.log("optional compatibility upgrades preserve stock TypeScript declarations and runtime behavior")
