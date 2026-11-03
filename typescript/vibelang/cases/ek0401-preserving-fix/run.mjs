// run-seconds: 180
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? resolve(here, "../../../built/local/tsc")
const stock = resolve(here, "../../../../experiments/node_modules/typescript/bin/tsc")
const dir = mkdtempSync(join(tmpdir(), "ek0401-preserving-"))
const common = 'import { Effect } from "effect"\nexport const events: string[] = []\nconst marker = "marker"\n'
const fixtures = [
  ["inferred-arrow", 'export const f = (n: number) => { events.push("operand"); throw marker }'],
  ["inferred-function", 'export function f(n: number) { events.push("operand"); throw marker }'],
  ["statement", 'export function f(n: number): number { events.push("before"); if (n) throw (events.push("operand"), marker); events.push("after"); return n }'],
  ["expression", 'export function f(n: number): number { events.push("before"); return n || throw (events.push("operand"), marker) }',
    'export function f(n: number): number { events.push("before"); return n || (() => { throw (events.push("operand"), marker) })() }'],
  ["native-catch", 'export function f(n: number): number { try { events.push("before"); throw (events.push("operand"), marker) } catch(e) { events.push(String(e)); return n } }'],
  ["default", 'export function f(n: number = throw (events.push("default"), marker)): number { events.push("body"); return n }',
    'export function f(n: number = (() => { throw (events.push("default"), marker) })()): number { events.push("body"); return n }'],
  ["smithers-Store-Effect-try", 'export function f(n: number): Effect.Effect<number, unknown> { return Effect.try({try: () => { events.push("before"); if(n) throw (events.push("operand"), marker); return n }, catch: (e) => e}) }'],
  ["plain-handler", 'export effect function f(n: number) { return (Effect.fail(n) catch (e) => { events.push("handler"); throw e }) }',
    'export function f(n: number) { return Effect.catch(Effect.fail(n), (e) => Effect.sync(() => { events.push("handler"); throw e })) }'],
]
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target:"ES2022", module:"NodeNext", strict:true, skipLibCheck:true, declaration:true, outDir:"out" }, files:["main.vibe", "twin.ts"] }))
  for (const [name, source, twin = source] of fixtures) {
    writeFileSync(join(dir, "main.vibe"), common + source)
    writeFileSync(join(dir, "twin.ts"), common + twin)
    writeFileSync(join(dir, "tsconfig.stock.json"), JSON.stringify({ compilerOptions: { target:"ES2022", module:"NodeNext", strict:true, skipLibCheck:true, declaration:true, outDir:"stock" }, files:["twin.ts"] }))
    const checked = spawnSync(process.execPath,[stock,"-p",join(dir,"tsconfig.stock.json"),"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.equal(checked.status,0,name+" stock TypeScript 5.9.3 twin\n"+checked.stdout+checked.stderr)
    const fixed = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding:"utf8", timeout:120000 })
    assert.ifError(fixed.error)
    assert.equal(fixed.status, 0, name + "\n" + fixed.stdout + fixed.stderr)
    const text = readFileSync(join(dir, "main.vibe"), "utf8")
    if(name==="plain-handler") assert.match(text,/catch effect.*die\(/,name)
    else assert.match(text, /module \$throw\$ts/, name)
    assert.doesNotMatch(fixed.stdout, /refused site:.*EK0401/, name)
    const declaration = readFileSync(join(dir, "out/main.d.ts"), "utf8")
    assert.doesNotMatch(declaration, /\$raise|raise\(|\$throw\$ts/, name + " helper leaked into API")
    assert.match(declaration, /export declare (?:function f\(n.*\)|const f:)/, name)
    writeFileSync(join(dir,"api.ts"),'import {f as actual} from "./out/main.js"; import {f as expected} from "./stock/twin.js"; const a:typeof actual=expected; const b:typeof expected=actual;')
    writeFileSync(join(dir,"tsconfig.api.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,noEmit:true},files:["api.ts"]}))
    const api=spawnSync(process.execPath,[stock,"-p",join(dir,"tsconfig.api.json"),"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.equal(api.status,0,name+" declaration compatibility\\n"+api.stdout+api.stderr)
    const observation = [
      'import assert from "node:assert/strict";',
      'import { Effect, Exit } from "effect";',
      'import * as a from "./out/main.js";',
      'import * as b from "./stock/twin.js";',
      'function observe(m, n) {',
      'm.events.length=0;',
      'const exit=Effect.runSyncExit(Effect.suspend(() => {',
      'const value=m.f(n);',
      'return Effect.isEffect(value) ? value : Effect.succeed(value);',
      '}));',
      'return {events:m.events.slice(),exit:Exit.isSuccess(exit)',
      '? {tag:"Success",value:exit.value}',
      ': {tag:"Failure",reasons:exit.cause.reasons.map(r=>({tag:r._tag,value:r._tag==="Die"?r.defect:r.error}))}};',
      '}',
      'for(const n of [0,1,undefined]) assert.deepEqual(observe(a,n),observe(b,n),'+JSON.stringify(name)+');',
    ].join("\n")
    writeFileSync(join(dir, "observe.mjs"), observation)
    const ran = spawnSync(process.execPath, [join(dir, "observe.mjs")], { encoding:"utf8", timeout:30000 })
    assert.equal(ran.status, 0, name + "\n" + ran.stdout + ran.stderr)
    const again = spawnSync(compiler, ["-p",dir,"--fix","--noEmit","--pretty","false"], { encoding:"utf8", timeout:120000 })
    assert.equal(again.status,0,again.stdout+again.stderr)
    assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),text,name+" fix is not idempotent")
  }
} finally { rmSync(dir, { recursive:true, force:true }) }
console.log("EK0401 throw repairs preserve native throws, evaluation order, declarations and TypeScript twin Exits")
