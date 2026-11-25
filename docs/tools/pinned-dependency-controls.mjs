import { spawnSync } from "node:child_process"
// Engine and library controls used when updating the pinned dependencies.
import assert from "node:assert/strict"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { join } from "node:path"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { Clock, Effect, Exit, Stream } from "effect"
import fc from "fast-check"
import ts from "typescript"
import { run, tools } from "./spec-witness.mjs"

test("Dependency control: native generator ownership does not cross nongenerator function boundaries", () => {
  for (const source of [
    "async function f() { yield 1 }",
    "async function* outer() { const inner = () => { yield 1 } }",
    "async function* outer() { async function inner() { yield 1 } }",
    "async function* outer() { function inner() { yield 1 } }"
  ]) assert.throws(() => new Function(`\"use strict\"; ${source}`), SyntaxError)
  const first = new Function("\"use strict\"; async function f() { function* own() { yield 1 }; return own().next().value }; return f()")()
  return first.then(value => assert.equal(value, 1))
})

// The left operand of exponentiation is an UpdateExpression, so a unary operator there is a SyntaxError unless
// parenthesized. The spec cites `await a ** b`, which ECMA-262 rejects the same
// way (V8 does; JavaScriptCore accepts it), so the check uses unary minus,
// which every engine rejects.
test("Dependency control: ECMAScript rejects an unparenthesized unary operand on the left of **", () => {
  assert.throws(() => new Function("return -2 ** 2"), SyntaxError)
  assert.equal(new Function("return (-2) ** 2")(), 4)
})

test("Dependency control: native async return assimilates a Promise and thenable, while Effect success keeps data", async () => {
  async function nativeReturn(value) { return value }
  assert.equal(await nativeReturn(Promise.resolve(7)), 7)
  assert.equal(await Promise.reject("source").catch(() => ({ then(resolve) { resolve(9) } })), 9)
  let calls = 0
  const thenable = { then(resolve) { calls++; resolve(8) } }
  const value = Effect.runSyncExit(Effect.gen(function* () { return thenable }))
  assert.equal(value._tag, "Success")
  assert.equal(value.value, thenable)
  assert.equal(calls, 0)
  assert.equal(await nativeReturn(thenable), 8)
  assert.equal(calls, 1)
})

test("Dependency control: native Promise resolution handles every return-value branch without inspecting Effect success data", async () => {
  async function adopt(value) { return value }
  const keep = value => {
    for (const program of [
      Effect.gen(function* () { return value }),
      Effect.gen(function* () { return yield* Effect.succeed(value) }),
      Effect.catch(Effect.fail("source"), () => Effect.succeed(value))
    ]) {
      const exit = Effect.runSyncExit(program)
      assert.equal(exit._tag, "Success")
      assert.equal(exit.value, value)
    }
  }
  let executions = 0
  const cold = Effect.sync(() => { executions++; return 7 })
  keep(cold)
  keep(Effect.fail("unrun failure"))
  assert.equal(executions, 0)
  for (const value of [undefined, null, false, -0, 0, NaN, 7, "x", Symbol("x"), 1n]) {
    keep(value)
    assert.equal(await adopt(value), value)
  }
  const ordinary = { then: 0 }
  keep(ordinary)
  assert.equal(await adopt(ordinary), ordinary)
  const error = { tag: "same-error" }
  const badGet = { get then() { throw error } }
  keep(badGet)
  await assert.rejects(adopt(badGet), value => value === error)
  let gets = 0, calls = 0
  const thenable = {
    get then() {
      gets++
      return function(resolve, reject) {
        assert.equal(this, thenable)
        calls++
        resolve(7)
        reject(error)
        throw error
      }
    }
  }
  keep(thenable)
  assert.equal(gets, 0)
  const adopted = adopt(thenable)
  assert.equal(gets, 1)
  assert.equal(calls, 0)
  assert.equal(await adopted, 7)
  assert.equal(gets, 1)
  assert.equal(calls, 1)
  for (const value of [
    { then(resolve, reject) { reject(error); resolve(7) } },
    { then() { throw error } }
  ]) {
    keep(value)
    await assert.rejects(adopt(value), reason => reason === error)
  }
  const revoked = Proxy.revocable(() => {}, {})
  revoked.revoke()
  const revokedThen = { then: revoked.proxy }
  keep(revokedThen)
  await assert.rejects(adopt(revokedThen), TypeError)
  const foreign = runInNewContext("(() => { const error = new Error('foreign'); return { error, value: { then() { throw error } } } })()")
  keep(foreign.value)
  await assert.rejects(adopt(foreign.value), reason => reason === foreign.error)
  let release
  const gate = new Promise(resolve => { release = resolve })
  let self
  self = (async () => { await gate; return self })()
  release()
  await assert.rejects(self, TypeError)
  let recursive
  recursive = Effect.gen(function* () { return recursive })
  const exit = Effect.runSyncExit(recursive)
  assert.equal(exit._tag, "Success")
  assert.equal(exit.value, recursive)
})

const closing = (log) => ({
  [Symbol.iterator]() { return this },
  next() { return { done: false, value: 1 } },
  return() { log.push("close"); return {} },
})

test("Dependency control: a rejected await resumes with a throw, so cleanup runs", async () => {
  const log = []
  const body = async () => {
    using _ = { [Symbol.dispose]() { log.push("dispose") } }
    try { for (const _ of closing(log)) await Promise.reject("r") } finally { log.push("finally") }
  }
  await assert.rejects(body(), (e) => e === "r")
  assert.deepEqual(log, ["close", "finally", "dispose"])
})

test("Dependency control: a failed try never resumes the generator, so no cleanup runs", () => {
  for (const failure of [Effect.fail("f"), Effect.die("d")]) {
    const log = []
    const body = Effect.gen(function* () {
      using _ = { [Symbol.dispose]() { log.push("dispose") } }
      try { for (const _ of closing(log)) yield* failure } finally { log.push("finally") }
    })
    assert.ok(Exit.isFailure(Effect.runSyncExit(body)))
    assert.deepEqual(log, [])
  }
})

test("Dependency control: a JavaScript throw in the generator does unwind it", () => {
  const log = []
  const body = Effect.gen(function* () {
    for (const _ of closing(log)) throw "t"
  })
  assert.ok(Exit.isFailure(Effect.runSyncExit(body)))
  assert.deepEqual(log, ["close"])
})

test("Dependency control: fast-check: foreign generic and default-callback witnesses preserve explicit failure values", () => {
  fc.assert(fc.property(fc.string(), fc.integer(), (reason, value) => {
    const keep = input => { throw reason }
    const invoke = (callback = () => { throw reason }) => callback()
    for (const call of [() => keep(Effect.succeed(value)), () => invoke(), () => invoke(undefined)]) {
      const exit = Effect.runSyncExit(Effect.try({ try: call, catch: error => error }))
      assert.equal(exit._tag, "Failure")
      assert.deepEqual(exit.cause.reasons.map(r => [r._tag, r.error]), [["Fail", reason]])
    }
    assert.equal(Effect.runSync(Effect.try({ try: () => invoke(() => value), catch: error => error })), value)
    const passEffect = input => input
    assert.equal(Effect.runSync(passEffect(Effect.succeed(value))), value)
  }), { seed: 40016, numRuns: 150 })
})

test("Dependency control: native iterator failures retain error identity, message and reached protocol order", () => {
  const marker = new Error("protocol")
  const cases = [
    () => 5,
    () => undefined,
    () => Promise.resolve(5),
    () => ({ get [Symbol.iterator]() { throw marker } }),
    () => ({ [Symbol.iterator]: 1 }),
    () => ({ [Symbol.iterator]() { return 1 } }),
    () => ({ [Symbol.iterator]() { return { next: 1 } } }),
    () => ({ [Symbol.iterator]() { return { next() { return 1 } } } }),
    () => ({ [Symbol.iterator]() { return { next() { return { get done() { throw marker } } } } } }),
    () => ({ [Symbol.iterator]() { return { next() { return { done: true, get value() { throw marker } } } } } })
  ]
  for (const make of cases) {
    let reference
    try { (function* () { return yield* make() })().next() } catch (error) { reference = error }
    assert.ok(reference, "native control must throw")
    const result = Effect.runSyncExit(Effect.gen(function* () { return yield* make() }))
    assert.ok(Exit.isFailure(result))
    assert.equal(result.cause.reasons.length, 1)
    const reason = result.cause.reasons[0]
    assert.equal(reason._tag, "Die")
    assert.equal(reason.defect.name, reference.name)
    assert.equal(reason.defect.message, reference.message)
    if (reference === marker) assert.equal(reason.defect, marker)
  }
  const trace = []
  const iterable = {
    get [Symbol.iterator]() {
      trace.push("iterator:get")
      return function () {
        assert.equal(this, iterable)
        trace.push("iterator:call")
        return {
          get next() {
            trace.push("next:get")
            return function () {
              trace.push("next:call")
              return {
                get done() { trace.push("done"); return true },
                get value() { trace.push("value"); return 9 }
              }
            }
          }
        }
      }
    }
  }
  const program = Effect.gen(function* () { trace.push("operand"); return yield* iterable })
  assert.deepEqual(trace, [])
  const result = Effect.runSyncExit(program)
  assert.ok(Exit.isSuccess(result))
  assert.equal(result.value, 9)
  assert.deepEqual(trace, ["operand", "iterator:get", "iterator:call", "next:get", "next:call", "done", "value"])
})

test("Dependency control: Effect drives only next and does not synthesize iterator throw or return on abandonment", () => {
  for (const operand of [Effect.fail("bad"), Effect.die("boom"), Effect.interrupt]) {
    const trace = []
    const iterable = {
      [Symbol.iterator]() {
        return {
          next() { trace.push("next"); return { done: false, value: operand } },
          get throw() { trace.push("throw"); throw new Error("must not be read") },
          get return() { trace.push("return"); throw new Error("must not be read") }
        }
      }
    }
    const result = Effect.runSyncExit(Effect.gen(function* () {
      yield* iterable
      trace.push("after")
    }))
    assert.ok(Exit.isFailure(result))
    assert.deepEqual(trace, ["next"])
  }
})

const protocol = "import { Effect } from \"effect\"\nconst assert = {\n  equal(a: unknown, b: unknown) { if (!Object.is(a, b)) throw new Error(\"unequal native values\") },\n  deepEqual(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(\"unequal trace\") },\n  ok(value: unknown) { if (!value) throw new Error(\"native assertion failed\") }\n}\n\nconst trace: string[] = []\nconst sites: TemplateStringsArray[] = []\nconst host = {\n  base: 2,\n  get tag() {\n    trace.push(\"get\")\n    return this.invoke\n  },\n  invoke(parts: TemplateStringsArray, value: number): Promise<number> {\n    trace.push(\"call\")\n    assert.equal(this, host)\n    sites.push(parts)\n    return Promise.resolve(this.base + value)\n  }\n}\nconst substitution = () => { trace.push(\"substitution\"); return 7 }\nconst receiverBridge = () => Effect.tryPromise(() => host.tag`x${substitution()}`)\nassert.equal(await Effect.runPromise(receiverBridge()), 9)\nassert.equal(await Effect.runPromise(receiverBridge()), 9)\nassert.deepEqual(trace, [\"get\", \"substitution\", \"call\", \"get\", \"substitution\", \"call\"])\nassert.equal(sites[0], sites[1])\nassert.ok(Object.isFrozen(sites[0]) && Object.isFrozen(sites[0].raw))\nfunction constructionTag(_parts: TemplateStringsArray): Promise<number> { throw \"construction\" }\nasync function rejectedTag(_parts: TemplateStringsArray): Promise<number> { throw \"rejection\" }\nfor (const [program, expected] of [\n  [Effect.tryPromise({ try: () => constructionTag`x`, catch: error => error }), \"construction\"],\n  [Effect.tryPromise({ try: () => rejectedTag`x`, catch: error => error }), \"rejection\"]\n] as const) {\n  const exit = await Effect.runPromiseExit(program)\n  assert.equal(exit._tag, \"Failure\")\n  if (exit._tag === \"Failure\") {\n    assert.deepEqual(exit.cause.reasons.map(reason => reason._tag === \"Fail\" ? reason.error : reason._tag), [expected])\n  }\n}\nconsole.log(\"receiver, callee-before-substitution, one substitution/run, shared frozen template site, construction failure and rejection: pass\")\n"
test("Dependency control: the native bridge preserves receiver, template site, substitutions and both failure phases", () => {
  const result = run(protocol)
  assert.equal(result.status, 0, result.stderr)
})

test("Dependency control: native Effect pairs retain documentation and visibility on the constant", { timeout: 60000 }, () => {
  const docs = ["", "/** Wire message. */", "/** First line.\n * Second line.\n */",
    "/** @internal */", "/** @public */", "/** @deprecated Use another schema. */",
    "/** Wire message.\n * @public\n * @deprecated Use another schema.\n */", "// ordinary comment"]
  const source = 'import * as Schema from "effect/Schema"\n' + docs.map((doc, i) =>
    doc + "\nexport const S" + i + ' = Schema.Struct({ id: Schema.String })\n' +
    "export type S" + i + " = typeof S" + i + ".Type\n").join("\n")
  const file = join(tools, "__schema_jsdoc_control.ts")
  for (const removeComments of [false, true]) for (const stripInternal of [false, true]) {
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true,
      types: [], declaration: true, emitDeclarationOnly: true, removeComments, stripInternal }
    const host = ts.createCompilerHost(options)
    const original = host.getSourceFile.bind(host)
    host.getSourceFile = (name, ...args) => name === file
      ? ts.createSourceFile(file, source, options.target, true) : original(name, ...args)
    let output = ""
    host.writeFile = (name, text) => { if (name.endsWith(".d.ts")) output = text }
    const program = ts.createProgram([file], options, host)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
    assert.equal(program.emit().emitSkipped, false)
    for (let i = 0; i < docs.length; i++) {
      assert.ok(output.includes("export type S" + i + " = typeof S" + i + ".Type;"))
      assert.equal(output.includes("export declare const S" + i + ":"), !(stripInternal && i === 3))
    }
    assert.equal((output.match(/Wire message/g) || []).length, removeComments ? 0 : 2)
    assert.equal((output.match(/@deprecated/g) || []).length, removeComments ? 0 : 2)
    assert.doesNotMatch(output, /\*\/\s*export type/)
    assert.doesNotMatch(output, /ordinary comment/)
  }
})

test("Dependency control: native type lookup separates library generic symbols from local type and value names", { timeout: 60000 }, () => {
  const sources = new Map(), witnesses = []
  for (const [name, params, args] of [
    ["Array", "T", "number"], ["ReadonlyArray", "T", "number"],
    ["Record", "K,V", "string,number"], ["Readonly", "T", "{x:number}"]
  ]) for (const kind of ["library", "value", "alias", "interface", "class"]) {
    const binding = {
      library: "", value: "const " + name + " = 1;",
      alias: "type " + name + "<" + params + "> = {own:number};",
      interface: "interface " + name + "<" + params + "> {own:number}",
      class: "class " + name + "<" + params + "> {own = 1}"
    }[kind]
    const file = join(tools, "__schema_binding_" + name + "_" + kind + ".ts")
    sources.set(file, "export {}; " + binding + " type Selected = " + name + "<" + args + ">;")
    witnesses.push({file, library: kind === "library" || kind === "value"})
  }
  const options = {target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.NodeNext,
    moduleResolution:ts.ModuleResolutionKind.NodeNext, strict:true, skipLibCheck:true, types:[]}
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (file, ...args) => sources.has(file)
    ? ts.createSourceFile(file, sources.get(file), options.target, true) : original(file, ...args)
  const program = ts.createProgram([...sources.keys()], options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>d.code), [])
  const checker = program.getTypeChecker()
  for (const {file, library} of witnesses) {
    const node = program.getSourceFile(file).statements.find(n => ts.isTypeAliasDeclaration(n) && n.name.text === "Selected")
    const selected = checker.getSymbolAtLocation(node.type.typeName)
    assert.ok(selected, file)
    assert.equal(selected.declarations.some(d=>program.isSourceFileDefaultLibrary(d.getSourceFile())), library, file)
  }
})

test("Dependency control: native bodyless method and property options follow the printed interface counterpart",()=>{
 const directory=mkdtempSync(join(tmpdir(),"service-any-"))
 try{
  for(const explicit of [false,true]){
   const file=join(directory,"shape.ts")
   writeFileSync(file,explicit?"interface Reader { read(): any; value: any }":"interface Reader { read(); value }")
   for(const noImplicitAny of [false,true]){
    const p=ts.createProgram([file],{strict:true,noImplicitAny,noEmit:true,skipLibCheck:true})
    const codes=ts.getPreEmitDiagnostics(p).filter(d=>d.file?.fileName===file).map(d=>d.code).sort()
    assert.deepEqual(codes,explicit||!noImplicitAny?[]:[7008,7010])
   }
  }
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test("Dependency control: native TypeScript suppresses discovered sibling declarations and protects explicit inputs",()=>{
 const dir=mkdtempSync(join(tmpdir(),"sidecar-input-"))
 try{
  for(const explicit of [false,true]){
   const source=join(dir,"main.ts"),declaration=join(dir,"main.d.ts")
   const original="export declare const value: string; // hand-written\n"
   writeFileSync(source,"export const value = 1;")
   writeFileSync(declaration,original)
   const selection=explicit?{files:["main.ts","main.d.ts"]}:{include:["main.ts","main.d.ts"]}
   const parsed=ts.parseJsonConfigFileContent({compilerOptions:{declaration:true,skipLibCheck:true},...selection},ts.sys,dir)
   assert.equal(parsed.fileNames.includes(declaration),explicit)
   const p=ts.createProgram(parsed.fileNames,parsed.options)
   const result=p.emit()
   const codes=[...ts.getPreEmitDiagnostics(p),...result.diagnostics].map(d=>d.code)
   assert.equal(codes.includes(5055),explicit)
   if(explicit)assert.equal(readFileSync(declaration,"utf8"),original)
   else assert.match(readFileSync(declaration,"utf8"),/value = 1/)
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
})

function declarationPaths(project, shared) {
  const files = new Map([[`/repo/${project}/src/local.ts`, "export const local = 1;"],
    [`/repo/${shared}/remote.ts`, "export const remote = 2;"]]);
  const options = { declaration: true, emitDeclarationOnly: true, noLib: true,
    declarationDir: `/repo/${project}/.vibe/declarations`, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => "/repo/" + project;
  host.fileExists = path => files.has(path);
  host.readFile = path => files.get(path);
  host.getSourceFile = (path, version) => files.has(path) ? ts.createSourceFile(path, files.get(path), version) : undefined;
  const output = [];
  host.writeFile = path => output.push(path);
  const program = ts.createProgram([...files.keys()], options, host);
  program.emit();
  return { root: program.getCommonSourceDirectory(), output };
}
test("Dependency control: TypeScript outside-source witness uses the common root", () => {
  assert.deepEqual(declarationPaths("app", "shared"), { root: "/repo/", output: [
    "/repo/app/.vibe/declarations/app/src/local.d.ts",
    "/repo/app/.vibe/declarations/shared/remote.d.ts"
  ] });
});
test("Dependency control: source-directory mutations keep native declaration placement", () => {
  fc.assert(fc.property(fc.constantFrom("app", "project", "package"),
    fc.constantFrom("shared", "common", "lib"), (project, shared) => {
      const result = declarationPaths(project, shared);
      assert.equal(result.root, "/repo/");
      assert.deepEqual(result.output, [
        `/repo/${project}/.vibe/declarations/${project}/src/local.d.ts`,
        `/repo/${project}/.vibe/declarations/${shared}/remote.d.ts`
      ]);
    }), { seed: 183, numRuns: 50 });
});

test("Dependency control: TypeScript parses a side-effect import as an ordinary ImportDeclaration", () => {
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,18}$/), name => {
    const source = 'import "./' + name + '.js";'
    const file = ts.createSourceFile("twin.ts", source, ts.ScriptTarget.Latest, true)
    assert.equal(file.parseDiagnostics.length, 0)
    assert.equal(file.statements.length, 1)
    assert.ok(ts.isImportDeclaration(file.statements[0]))
    assert.equal(file.statements[0].importClause, undefined)
    assert.equal(file.statements[0].moduleSpecifier.text, "./" + name + ".js")
  }), { seed: 25001, numRuns: 200 })
})

for (const mode of ["readLine", "readInput"]) {
  test(`Dependency control: Node terminal raw-mode lifetime for ${mode}`, () => {
    const source = `
      import assert from "node:assert/strict"
      import { Effect, Queue } from "effect"
      import * as NodeTerminal from "@effect/platform-node/NodeTerminal"
      const raw = []
      Object.defineProperty(process.stdin, "isTTY", { value: true })
      process.stdin.setRawMode = (enabled) => { raw.push(enabled); return process.stdin }
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const terminal = yield* NodeTerminal.make()
        if (${JSON.stringify(mode)} === "readLine") {
          assert.equal(yield* terminal.readLine, "Ada")
        } else {
          const keys = yield* terminal.readInput
          const key = yield* Queue.take(keys)
          assert.equal(key.input.value, "A")
        }
      })))
      assert.deepEqual(raw, ${mode === "readLine" ? "[]" : "[true, false]"})
    `
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: new URL(".", import.meta.url), input: "Ada\n", encoding: "utf8", timeout: 10000
    })
    assert.equal(result.status, 0, result.stderr || String(result.error))
  })
}

test("Dependency control: periodic streams sample the real clock until the requested limit", async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 8 }),
    fc.integer({ min: 1, max: 3 }),
    async (count, interval) => {
      const source = Stream.mapEffect(Stream.tick(interval), () => Clock.currentTimeMillis)
      const samples = await Effect.runPromise(Stream.runCollect(Stream.take(source, count)))
      assert.equal(samples.length, count)
      assert.ok(samples.every(Number.isFinite))
    }
  ), { numRuns: 30, seed: 531054, examples: [[0, 1], [1, 1], [4, 1], [8, 3]] })
})
