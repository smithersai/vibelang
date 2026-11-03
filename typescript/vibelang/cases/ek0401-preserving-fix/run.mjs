// run-seconds: 180
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs"
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
  ["native-effect-catch", 'export function f(n:number):Effect.Effect<number,string> {try{events.push("factory");if(n)throw (events.push("operand"),marker);return Effect.succeed(n)}catch(e){events.push("catch");return Effect.fail(String(e))}}'],
  ["native-effect-catch-cleanup", 'export function f(n:number):Effect.Effect<number,string> {const xs={*[Symbol.iterator](){try{yield n}finally{events.push("close");if(n)throw "cleanup"}}};try{for(const x of xs){events.push("operand");throw marker};return Effect.succeed(n)}catch(e){events.push("catch:"+String(e));return Effect.fail(String(e))}}'],

  ["known-call", 'export function f(n: number): unknown { events.push("before"); return JSON.parse(n ? "(" : String((events.push("arg"), n))) }'],
  ["known-default", 'export function f(n: unknown = JSON.parse((events.push("default"), "0"))): unknown { events.push("body"); return n }'],
  ["known-receiver", 'import {reader} from "./native.js"\nexport function f(n:number):number {events.push("before");return reader.read(n ?? 0)}',
    'const reader={count:0, read(n:number):number {this.count++;if(n<0)throw new Error("bad");return this.count+n}}; export function f(n:number):number {events.push("before");return reader.read(n ?? 0)}'],
  ["known-literal", 'import {literal} from "./native.js"\nexport const f=(n:number):infer _=>literal()',
    'function literal():"ok" {return "ok"}; export const f=(n:number)=>literal()'],
  ["known-getter", 'import {getter as reader,log} from "./native.js"\nexport function f(n:number):number {log.length=0;const result=reader.read((log.push("arg"),n));events.push(...log);return result}',
    'const log:string[]=[];function read(this:unknown,n:number):number {log.push("call:"+n+":"+(this===reader));return n};const reader={get read(){log.push("get");return read}};export function f(n:number):number {log.length=0;const result=reader.read((log.push("arg"),n));events.push(...log);return result}'],
  ["known-new", 'import {Box} from "./native.js"\nexport function f(n:number):number{return new Box(n ?? 0).n}',
    'class Box{constructor(readonly n:number){if(n<0)throw new Error("bad")}};export function f(n:number):number{return new Box(n ?? 0).n}'],
  ["known-bigint-narrowing", 'export function f(n:number):bigint {const input:{id?:string|null}={id:n<0?"(":n===0?null:String(n??1)};return input.id==null?0n:BigInt(input.id)}'],
  ["effect-factory", 'export effect function f(n:number) {function task():number!! {events.push("factory");if(n)throw marker;return Effect.succeed(n)};return try task()}',
    'export function f(n:number) {return Effect.gen(function*(){function task():Effect.Effect<number> {events.push("factory");if(n)throw marker;return Effect.succeed(n)};return yield* task()})}'],

  ["effect-factory-error", 'export effect function f(n:number) {function task():number!string {events.push("factory");if(n<0)throw marker;return n?Effect.fail("typed"):Effect.succeed(n)};return try task()}',
    'export function f(n:number) {return Effect.gen(function*(){function task():Effect.Effect<number,string> {events.push("factory");if(n<0)throw marker;return n?Effect.fail("typed"):Effect.succeed(n)};return yield* task()})}'],

  ["effect-factory-suspend", 'export function f(n:number):Effect.Effect<number,string> {return Effect.suspend(()=>{events.push("factory");if(n<0)throw marker;return n?Effect.fail("typed"):Effect.succeed(n)})}'],
  ["effect-factory-suspend-tail", 'export function f(n:number):Effect.Effect<number,string> {return Effect.suspend(()=>n<0?throw (events.push("operand"),marker):n?Effect.fail("typed"):Effect.succeed(n))}',
    'export function f(n:number):Effect.Effect<number,string> {return Effect.suspend(()=>n<0?(()=>{throw (events.push("operand"),marker)})():n?Effect.fail("typed"):Effect.succeed(n))}'],

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
  writeFileSync(join(dir,"native.ts"), [
    'export const log:string[]=[];',
    '/** @throws {Error} */',
    'function read(this:unknown,n:number):number {log.push("call:"+n+":"+(this===getter));return n}',
    'export const getter={get read(){log.push("get");return read}};',
    'export const reader={count:0,',
    '/** @throws {Error} */',
    'read(n:number):number {this.count++;if(n<0)throw new Error("bad");return this.count+n}};',
    '/** @throws {Error} */',
    'export function literal():"ok"{return "ok"}',
    'export class Box {',
    '/** @throws {Error} */',
    'constructor(readonly n:number){if(n<0)throw new Error("bad")}}',
  ].join("\n"))
  for (const [name, source, twin = source] of fixtures) {
    writeFileSync(join(dir, "main.vibe"), common + source)
    writeFileSync(join(dir, "twin.ts"), common + twin)
    writeFileSync(join(dir, "tsconfig.stock.json"), JSON.stringify({ compilerOptions: { target:"ES2022", module:"NodeNext", strict:true, skipLibCheck:true, declaration:true, outDir:"stock" }, files:["twin.ts"] }))
    const checked = spawnSync(process.execPath,[stock,"-p",join(dir,"tsconfig.stock.json"),"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.equal(checked.status,0,name+" stock TypeScript 5.9.3 twin\n"+checked.stdout+checked.stderr)
    if(process.env.VIBELANG_BASELINE && (name.startsWith("known-") || name.startsWith("effect-factory") || name.startsWith("native-effect-catch"))) {
      const baseline=spawnSync(process.env.VIBELANG_BASELINE,["-p",dir,"--fix","--noEmit","--pretty","false"],{encoding:"utf8",timeout:120000})
      assert.equal(baseline.status,2,name+" must fail before this fix\n"+baseline.stdout+baseline.stderr)
      assert.match(baseline.stdout,/error EK0401:/,name+" missing original diagnostic")
      if(process.env.EK0401_EVIDENCE) {
        const dest=join(process.env.EK0401_EVIDENCE,name)
        mkdirSync(dest,{recursive:true})
        writeFileSync(join(dest,"before.log"),baseline.stdout+baseline.stderr)
      }
      writeFileSync(join(dir,"main.vibe"),common+source)
    }
    const fixed = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding:"utf8", timeout:120000 })
    assert.ifError(fixed.error)
    assert.equal(fixed.status, 0, name + "\n" + fixed.stdout + fixed.stderr)
    const text = readFileSync(join(dir, "main.vibe"), "utf8")
    if(name==="plain-handler") assert.match(text,/catch effect.*die\(/,name)
    else if(name.startsWith("effect-factory-suspend")) assert.match(text,/\bdie\(/,name)
    else if(name.startsWith("effect-factory")) assert.match(text,/return die\(/,name)
    else if(name.startsWith("known-")) assert.match(text,/module \$call\$ts/,name)
    else assert.match(text, /module \$throw\$ts/, name)
    assert.doesNotMatch(fixed.stdout, /refused site:.*EK0401/, name)
    const declaration = readFileSync(join(dir, "out/main.d.ts"), "utf8")
    assert.doesNotMatch(declaration, /\$raise|raise\(|\$throw\$ts|\$invoke|\$call\$ts/, name + " helper leaked into API")
    assert.match(declaration, /export declare (?:function f\(n.*\)|const f:)/, name)
    writeFileSync(join(dir,"api.ts"),'import {f as actual} from "./out/main.js"; import {f as expected} from "./stock/twin.js"; const a:typeof actual=expected; const b:typeof expected=actual; type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false; const equal:Equal<typeof actual,typeof expected>=true;')
    writeFileSync(join(dir,"tsconfig.api.json"),JSON.stringify({compilerOptions:{target:"ES2022",module:"NodeNext",strict:true,skipLibCheck:true,noEmit:true},files:["api.ts"]}))
    const api=spawnSync(process.execPath,[stock,"-p",join(dir,"tsconfig.api.json"),"--pretty","false"],{encoding:"utf8",timeout:120000})
    assert.equal(api.status,0,name+" declaration compatibility\\n"+api.stdout+api.stderr)
    const observation = [
      'import assert from "node:assert/strict";',
      'import { Effect, Exit } from "effect";',
      'import * as a from "./out/main.js";',
      'import * as b from "./stock/twin.js";',
      'const norm=(v)=>typeof v===\"bigint\"?{bigint:String(v)}:v instanceof Error?{name:v.name,message:v.message}:v;',
      'function observe(m, n) {',
      'm.events.length=0;',
      'const exit=Effect.runSyncExit(Effect.suspend(() => {',
      'const value=m.f(n);',
      'return Effect.isEffect(value) ? value : Effect.succeed(value);',
      '}));',
      'return {events:m.events.slice(),exit:Exit.isSuccess(exit)',
      '? {tag:"Success",value:norm(exit.value)}',
      ': {tag:"Failure",reasons:exit.cause.reasons.map(r=>({tag:r._tag,value:norm(r._tag==="Die"?r.defect:r.error)}))}};',
      '}',
      'const observations=[];',
      'for(const n of [-1,0,1,undefined]) {const actual=observe(a,n),twin=observe(b,n);assert.deepEqual(actual,twin,'+JSON.stringify(name)+');observations.push({input:String(n),actual,twin});}',
      'process.stdout.write(JSON.stringify(observations,null,2));',
    ].join("\n")
    writeFileSync(join(dir, "observe.mjs"), observation)
    const ran = spawnSync(process.execPath, [join(dir, "observe.mjs")], { encoding:"utf8", timeout:30000 })
    assert.equal(ran.status, 0, name + "\n" + ran.stdout + ran.stderr)
    if(process.env.EK0401_EVIDENCE) {
      const dest=join(process.env.EK0401_EVIDENCE,name)
      mkdirSync(dest,{recursive:true})
      for(const [file,value] of Object.entries({
        "before.vibe":common+source,"after.vibe":text,"twin.ts":common+twin,
        "native.ts":readFileSync(join(dir,"native.ts"),"utf8"),
        "actual.d.ts":declaration,"twin.d.ts":readFileSync(join(dir,"stock/twin.d.ts"),"utf8"),
        "observations.json":ran.stdout,
      })) writeFileSync(join(dest,file),value)
    }
    const again = spawnSync(compiler, ["-p",dir,"--fix","--noEmit","--pretty","false"], { encoding:"utf8", timeout:120000 })
    assert.equal(again.status,0,again.stdout+again.stderr)
    assert.equal(readFileSync(join(dir,"main.vibe"),"utf8"),text,name+" fix is not idempotent")
  }
} finally { rmSync(dir, { recursive:true, force:true }) }
console.log("EK0401 throw repairs preserve native throws, evaluation order, declarations and TypeScript twin Exits")
