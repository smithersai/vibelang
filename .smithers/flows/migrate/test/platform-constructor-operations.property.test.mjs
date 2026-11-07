import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { splitPlatformToModule } from "../lib/platform.mjs"
import { materialize } from "./helpers/host-operations-oracle.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-import-meta-constructor-loop.json", import.meta.url), "utf8"))
const js = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText

test("a constructor loop keeps its module metadata and statement order", () => {
  const result = splitPlatformToModule(corpus.text, "src/x.ts", ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  const { body, module } = materialize(result.module)
  assert.doesNotMatch(body, /import\.meta/)
  assert.match(module, /for \(let repeat/)
  assert.match(module, /new \(\$DatabaseSync\(\)\)/)
  assert.match(body, /return DatabaseSync/)
})

async function evaluate({ count, namespace, spread, failAt }) {
  const construct = namespace ? "host.Constructor" : "host"
  const arg = spread ? "...[mark(repeat)]" : "mark(repeat)"
  const source = [
    "export const log: string[] = [];",
    "const here = import.meta.url;",
    'function mark(n: number) { log.push("argument:" + n); (globalThis as any).__constructorTrace.push(["argument", n]); return n }',
    "export const values: object[] = [];",
    `for (let repeat = 0; repeat < ${count}; repeat++) {`,
    `  try { values.push(new ${construct}(${arg})) } catch (e) { log.push((e as Error).message) }`,
    "}",
    "export const metadata = here;",
  ].join("\n")
  const result = splitPlatformToModule(source, "src/x.ts", ts, { globals: ["host"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  const { body, module } = materialize(result.module)
  const root = mkdtempSync(join(tmpdir(), "constructor-operations-"))
  const previous = Object.getOwnPropertyDescriptor(globalThis, "host")
  const previousTrace = Object.getOwnPropertyDescriptor(globalThis, "__constructorTrace")
  try {
    for (const [name, text] of [["before.mjs", source], ["x.vibe.platform.mjs", body], ["x.mjs", module]]) writeFileSync(join(root, name), js(text))
    const run = async name => {
      const events = []
      Object.defineProperty(globalThis, "__constructorTrace", {configurable:true,value:events})
      function Constructor(value) {
        events.push(["construct", value, new.target === Constructor])
        if (value === failAt) throw new Error("constructor:" + value)
        this.value = value
      }
      let target = Constructor
      if (namespace) target = Object.defineProperty({}, "Constructor", { get() { events.push(["get"]); return Constructor } })
      Object.defineProperty(globalThis, "host", { configurable: true, get() { events.push(["root"]); return target } })
      const m = await import(pathToFileURL(join(root, name)).href)
      assert.ok(m.values.every(value => value instanceof Constructor))
      assert.equal(m.metadata, pathToFileURL(join(root, name)).href)
      return { log: m.log, values: m.values.map(x => x.value), events }
    }
    assert.deepEqual(await run("x.mjs"), await run("before.mjs"))
  } finally {
    if (previous) Object.defineProperty(globalThis, "host", previous)
    else delete globalThis.host
    if (previousTrace) Object.defineProperty(globalThis, "__constructorTrace", previousTrace)
    else delete globalThis.__constructorTrace
    rmSync(root, { recursive: true, force: true })
  }
}

test("constructor reads retain getters, arguments, new.target and exceptions", async () => {
  await evaluate({ count: 3, namespace: true, spread: true, failAt: 1 })
})

test("property: constructor operations preserve synchronous execution", async () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8").includes(corpus.rule))
  await fc.assert(fc.asyncProperty(
    fc.integer({min: 0, max: 5}), fc.boolean(), fc.boolean(), fc.integer({min:-1,max:5}),
    (count, namespace, spread, failAt) => evaluate({count,namespace,spread,failAt})
  ), {numRuns:24,seed:440940})
})

test("stock TypeScript keeps generic construction, overloads and instance types", () => {
  const root = mkdtempSync(join(tmpdir(), "constructor-types-"))
  const source = [
    'import { Box, Choice } from "node:constructors";',
    'export const metadata = import.meta.url;',
    'export function make<T>(value: T) { void import.meta.url; return new Box<T>(value) }',
    'export const stringChoice = new Choice("value");',
    'export const numberChoice = new Choice(42);',
  ].join("\n")
  const ambient = 'interface ImportMeta { url: string }\ndeclare module "node:constructors" { export class Box<T> { constructor(value: T); readonly value: T } export class Choice { constructor(value: string); constructor(value: number); readonly value: string | number } }'
  try {
    writeFileSync(join(root, "ambient.d.ts"), ambient)
    const result = splitPlatformToModule(source, "x.ts", ts)
    assert.ok(result && !result.refused, JSON.stringify(result))
    const {body,module} = materialize(result.module, "./x.vibe.platform.js")
    writeFileSync(join(root, "x.vibe.platform.ts"), body)
    function emit(name, text) {
      writeFileSync(join(root,name + ".ts"), text)
      const program = ts.createProgram([join(root,name + ".ts"),join(root,"ambient.d.ts")], {
        strict:true, declaration:true, emitDeclarationOnly:true, target:ts.ScriptTarget.ESNext,
        module:ts.ModuleKind.ESNext, moduleResolution:ts.ModuleResolutionKind.Bundler,
        types:[],lib:["lib.es5.d.ts"]
      })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText,"\n")),[])
      let output
      program.emit(undefined,(file,text) => {if(file === join(root,name + ".d.ts")) output=text})
      return output
    }
    // The imported constructor's instances are identical even if the emitter
    // chooses an import type query after moving its value import.
    const before = emit("before",source), after = emit("after",module)
    assert.match(before, /make<T>\(value: T\): Box<T>/)
    assert.match(after, /make<T>\(value: T\): import\("node:constructors"\).Box<T>/)
    for (const output of [before,after]) {
      assert.match(output, /stringChoice: (?:import\("node:constructors"\).)?Choice/)
      assert.match(output, /numberChoice: (?:import\("node:constructors"\).)?Choice/)
    }
  } finally {rmSync(root,{recursive:true,force:true})}
})

test("the constructor loop compiles through the native platform boundary", () => {
  const root = mkdtempSync(join(tmpdir(),"constructor-native-"))
  const native = process.env.VIBELANG_BINARY ?? new URL("../../../../packages/compiler/native/vibelang",import.meta.url).pathname
  const modules = new URL("../../../../packages/runtime/node_modules",import.meta.url).pathname
  try {
    symlinkSync(modules,join(root,"node_modules"),"dir")
    mkdirSync(join(root,"src"))
    writeFileSync(join(root,"package.json"),'{"type":"module","private":true}')
    writeFileSync(join(root,"tsconfig.json"),JSON.stringify({
      compilerOptions:{target:"ESNext",module:"ESNext",moduleResolution:"Bundler",strict:true,
        noEmit:true,skipLibCheck:true,types:["node"],allowImportingTsExtensions:true},
      include:["src"]
    }))
    const split = splitPlatformToModule(corpus.text,"src/x.ts",ts)
    assert.ok(split && !split.refused,JSON.stringify(split))
    writeFileSync(join(root,"src/x.vibe"),split.module)
    const result = spawnSync(native,["-p",join(root,"tsconfig.json")],{encoding:"utf8",timeout:120000})
    assert.equal(result.error,undefined,String(result.error))
    assert.equal(result.status,0,result.stdout+"\n"+result.stderr+"\n"+split.module)
  } finally {rmSync(root,{recursive:true,force:true})}
})
