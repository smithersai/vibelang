// Chapter 005: extraction preserves phase, captures, receiver and public types.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { project, check, nativeCheck } from "./coverage-tooling.mjs"

export async function verifyPlatformRepair(caseURL, kind, Effect) {
  const body = kind === "method"
    ? 'export class Client { constructor(readonly url:string) {} effect load() { const response=try Effect.tryPromise(()=>fetch(this.url)); return response.status } }'
    : kind === "meta"
      ? 'declare global { interface ImportMeta { readonly dirname:string } }\nexport effect function main() { return import.meta.dirname }'
      : 'export effect function load(url:string) { const response=try Effect.tryPromise(()=>fetch(url)); return response.status }'
  const source = 'import { Effect } from "effect"\n' + body
  const native = 'import { Effect } from "effect"\n' + (kind === "method"
    ? 'export class Client { constructor(readonly url:string) {} load() { return Effect.gen({self:this},function* () { const response=yield* Effect.tryPromise(()=>fetch(this.url)); return response.status }) } }'
    : kind === "meta"
      ? 'declare global { interface ImportMeta { readonly dirname:string } }\nexport function main() { return Effect.gen(function* () { return import.meta.dirname }) }'
      : 'export function load(url:string) { return Effect.gen(function* () { const response=yield* Effect.tryPromise(()=>fetch(url)); return response.status }) }')
  const reserved = Object.fromEntries(["main.ts", "main.platform.ts", "main.foreign.ts", "main.ffi.ts"].map(name => [name, 'export const sentinel="keep-'+name+'"\n']))
  const p = project(caseURL, "repair-" + kind, { "main.vibe": source, "baseline.ts": native, ...reserved },
    { files: ["main.vibe"], compilerOptions: { noEmit: false, declaration: true } })
  const config = { compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [], skipLibCheck: true, outDir: "build", declaration: true }, files: ["baseline.ts"] }
  p.write("native.json", JSON.stringify(config))
  let reference = nativeCheck(p, "native.json")
  assert.equal(reference.status, 0, reference.output)
  const before = check(p)
  assert.match(before.output, /error EK4402:/)
  const existing = fs.readdirSync(p.dir).filter(name => name.endsWith(".ts") && !name.endsWith(".d.vibe.ts"))
  const fixed = check(p, ["--fix"])
  for (const [name, text] of Object.entries(reserved)) assert.equal(p.read(name), text, "an existing foreign file changed")
  assert.equal(p.read("baseline.ts"), native)
  const created = fs.readdirSync(p.dir).filter(name => name.endsWith(".ts") && !name.endsWith(".d.vibe.ts") && !name.endsWith(".d.ts") && !existing.includes(name))
  const changed = p.read("main.vibe") !== source || created.length !== 0
  if (!changed || (created.length === 0 && p.read("main.vibe").includes(kind === "meta" ? "import.meta.dirname" : "fetch("))) {
    // An explicit service recommendation is the chapter's safe alternative.
    assert.match(fixed.output, kind === "meta" ? /\bPath(?:\.Path)?\b/ : /HttpClient/,
      "an unperformed repair needs its concrete Effect-service alternative")
    return
  }
  assert.ok(created.length > 0, "extraction needs a fresh sibling TypeScript module")
  const after = check(p)
  assert.equal(after.status, 0, after.output)
  assert.ok(fs.existsSync(path.join(p.dir, "main.d.vibe.ts")), "the repaired API needs its sidecar")
  const api = kind === "method"
    ? 'type Public=Assert<Equal<InstanceType<typeof Actual.Client>,InstanceType<typeof Native.Client>>>; type Args=Assert<Equal<ConstructorParameters<typeof Actual.Client>,ConstructorParameters<typeof Native.Client>>>'
    : 'type Public=Assert<Equal<typeof Actual.'+(kind === "meta" ? "main" : "load")+',typeof Native.'+(kind === "meta" ? "main" : "load")+'>>'
  p.write("contracts.ts", 'import type * as Actual from "./main.vibe";import type * as Native from "./baseline.js";type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type Assert<T extends true>=T;'+api)
  config.compilerOptions.noEmit = true
  config.compilerOptions.allowArbitraryExtensions = true
  config.files.push("contracts.ts")
  p.write("contracts.json", JSON.stringify(config))
  reference = nativeCheck(p, "contracts.json")
  assert.equal(reference.status, 0, reference.output)
  if (kind === "method") assert.match(p.read("main.d.vibe.ts"), /@throws\s*\{never\}[\s\S]*?constructor/,
    "extraction must not add synchronous constructor throws")
  const originalFetch = globalThis.fetch
  const events = []
  const stub = label => url => { events.push([label, String(url)]); return Promise.resolve({ status: 7 }) }
  try {
    globalThis.fetch = stub("import")
    const actual = await import(pathToFileURL(path.join(p.dir, "build/main.js")).href)
    const expected = await import(pathToFileURL(path.join(p.dir, "build/baseline.js")).href)
    if (kind === "meta") {
      const value = await Effect.runPromiseExit(Effect.timeout(actual.main(), "30 seconds"))
      assert.deepEqual(value, await Effect.runPromiseExit(Effect.timeout(expected.main(), "30 seconds")))
      assert.equal(value._tag, "Success")
      assert.equal(value.value, path.join(p.dir, "build"))
      return
    }
    async function trace(module) {
      events.length = 0
      globalThis.fetch = stub("call")
      let url = "coverage:first"
      let program
      if (kind === "method") {
        const client = new module.Client(url)
        assert.deepEqual(events, [], "construction started platform work")
        Object.defineProperty(client, "url", { get() {
          events.push(["url", url])
          // fetch(this.url) resolves the callee before this argument getter.
          globalThis.fetch = stub("argument")
          return url
        } })
        program = client.load()
      } else program = module.load(url)
      assert.deepEqual(events, [], "calling the Effect function must stay cold")
      globalThis.fetch = stub("run1")
      const first = await Effect.runPromiseExit(Effect.timeout(program, "30 seconds"))
      url = "coverage:second"
      globalThis.fetch = stub("run2")
      const second = await Effect.runPromiseExit(Effect.timeout(program, "30 seconds"))
      assert.equal(first._tag, "Success")
      assert.equal(second._tag, "Success")
      return { first, second, events: [...events] }
    }
    const result = await trace(actual)
    assert.deepEqual(result, await trace(expected))
    assert.deepEqual(result.events, kind === "method"
      ? [["url", "coverage:first"], ["run1", "coverage:first"], ["url", "coverage:second"], ["run2", "coverage:second"]]
      : [["run1", "coverage:first"], ["run2", "coverage:first"]])
  } finally { globalThis.fetch = originalFetch }
}
