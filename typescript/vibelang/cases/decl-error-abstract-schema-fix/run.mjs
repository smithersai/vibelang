// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_TEST_COMPILER ?? path.resolve(here, "../../../built/local/tsc")
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "abstract-schema-fix-"))
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "out", rootDir: "." }, files: ["main.vibe"] }
function run(exe, args, cwd) {
 const r = spawnSync(exe, args, { cwd, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
 assert.equal(r.status, 0, String(r.error ?? "") + "\n" + r.stdout + "\n" + r.stderr)
 return r.stdout.trim()
}
// Namespace aliases introduced to avoid capture name the same module exports.
function canonicalDeclarations(text) {
 const aliases = [...text.matchAll(/^import \* as ([A-Za-z_$][A-Za-z0-9_$]*) from "effect\/Schema";\r?\n/gm)]
 for (const [line, alias] of aliases) text = text.replace(line, "").replaceAll(alias + ".", 'import("effect/Schema").')
 return text
}
try {
 for (const empty of [false, true]) for (const shadow of [false, true]) {
  const name = (empty ? "empty" : "family") + (shadow ? "-shadow" : "")
  const dir = path.join(scratch, name)
  fs.mkdirSync(dir)
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}')
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
  const source = [
   'import * as S from "effect/Schema"',
   'import { $schemaErrorMember as registerMember } from "vibelang-runtime"',
   shadow ? "const Schema = 0; const $LegacySchemaErrorFamily = 1; const $ErrorSchemaFamily = 2" : "",
   "export abstract /*keep abstract*/ schema /*keep schema*/ error /*keep error*/ Busy { " + (empty ? "" : "code: string") + " }",
   'export class Concrete extends Busy.extend<Concrete>("Concrete")({ _tag: S.tag("Concrete"), ' + (empty ? "code: S.String, " : "") + "count: S.Number }) { static { registerMember(this) } }",
   "export effect function main() {",
   ' const error = new Concrete({code:"busy", count:7})',
   ' const decoded = try Effect.try(() => S.decodeUnknownSync(Busy)({_tag:"Concrete", code:"copy", count:9}))',
   " const encoded = try Effect.try(() => S.encodeSync(Busy)(error))",
   " return {decoded: decoded instanceof Concrete, tag: decoded._tag, encoded, code:error.code}",
   "}", ""
  ].join("\n")
  fs.writeFileSync(path.join(dir, "main.vibe"), source)
  const diagnostics = run(compiler, ["-p", ".", "--pretty", "false"], dir)
  assert.match(diagnostics, /warning EK1308:/, "missing schema root migration warning")
  const beforeDts = fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8")
  const exit = () => run(process.execPath, ["--input-type=module", "-e", 'import {Effect} from "effect"; import {main} from "./out/main.js"; console.log(JSON.stringify(Effect.runSyncExit(main())))'], dir)
  const before = exit()
  const value = JSON.parse(before)
  assert.equal(value._tag, "Success")
  assert.equal(value.value.decoded, true)
  assert.deepEqual(value.value.encoded, {_tag:"Concrete",code:"busy",count:7})
  run(compiler, ["-p", ".", "--fix", "--pretty", "false"], dir)
  const fixed = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
  assert.ok(fixed.includes("$schemaErrorFamily as ") && fixed.includes("static {"), "family registration disappeared")
  assert.ok(!fixed.includes("error /*keep error*/ Busy"), "schema root was left unchanged")
  for (const comment of ["/*keep abstract*/", "/*keep schema*/", "/*keep error*/"]) assert.ok(fixed.includes(comment), "lost " + comment)
  assert.equal(canonicalDeclarations(fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8")), canonicalDeclarations(beforeDts), "API changed: " + name)
  assert.equal(exit(), before, "Exit/codec changed: " + name)
  run(compiler, ["-p", ".", "--fix", "--pretty", "false"], dir)
  assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), fixed, "not idempotent")
  console.log(name, "API_EQUAL true EXIT_EQUAL true IDEMPOTENT true")
 }
} finally { fs.rmSync(scratch, {recursive:true,force:true}) }
