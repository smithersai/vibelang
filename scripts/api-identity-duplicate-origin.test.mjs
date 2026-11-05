import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, compareApiIdentityInWorker, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const manifest = JSON.stringify({ name: "@types/node", version: "24.12.4", types: "index.d.ts" })
const globals = 'declare namespace NodeJS {\n  /**\n   * The environment.\n   * @since v0.1.27\n   */\n  interface ProcessEnv { [key: string]: string | undefined }\n}\n'
const stream = 'declare module "stream" { export class Readable { read(): string } }\n'
const index = '/// <reference path="globals.d.ts" />\n/// <reference path="stream.d.ts" />\n'

function put(root, file, text) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function installNode(side, name, files = {}) {
  const at = "node_modules/" + name + "/"
  put(side, at + "package.json", manifest)
  put(side, at + "index.d.ts", files.index ?? index)
  put(side, at + "globals.d.ts", files.globals ?? globals)
  put(side, at + "stream.d.ts", files.stream ?? stream)
}

function project(side, { types, source = "export declare const env: NodeJS.ProcessEnv;\n" }) {
  put(side, "index.d.ts", source)
  put(side, "package.json", JSON.stringify({ name: "ambient-origin", type: "module", types: "./index.d.ts", exports: { ".": "./index.d.ts" } }))
  put(side, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, files: ["index.d.ts"] }))
}

function compare(build) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-duplicate-origin-"))
  try {
    const before = join(root, "before"), after = join(root, "after")
    build(before, after)
    return compareApiIdentity(ts, before, after, {})
  } finally { rmSync(root, { recursive: true, force: true }) }
}

const pair = side => { installNode(side, "@types/node"); installNode(side, "node-copy"); project(side, { types: ["node", "node-copy"] }) }
const single = side => { installNode(side, "@types/node"); project(side, { types: ["node"] }) }
const diagnostics = result => result.environmentDiagnostics.map(d => d.diagnostic)
const complete = result => {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}

test("byte-identical copies of one package on one side are one ambient origin", () => {
  complete(compare((before, after) => { pair(before); single(after) }))
  complete(compare((before, after) => { single(before); pair(after) }))
  complete(compare((before, after) => { pair(before); pair(after) }))
})

test("a real public change stays visible through duplicate origins", () => {
  const result = compare((before, after) => {
    pair(before)
    single(after)
    put(after, "index.d.ts", "export declare const env: string;\n")
  })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
})

test("copies that differ by one byte stay an ambiguous origin", () => {
  const result = compare((before, after) => {
    pair(before)
    put(before, "node_modules/node-copy/globals.d.ts", globals.replace("string | undefined", "string"))
    single(after)
  })
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.ok(diagnostics(result).some(text => text.startsWith("Ambiguous ambient declaration origin")), JSON.stringify(result))
})

test("a contributor loaded between the copies refuses, because overload order changes", () => {
  const between = 'declare namespace NodeJS { interface ProcessEnv { between?: string } }\n'
  const result = compare((before, after) => {
    installNode(before, "@types/node"); installNode(before, "node-copy")
    put(before, "node_modules/@types/between/package.json", JSON.stringify({ name: "@types/between", version: "1.0.0", types: "index.d.ts" }))
    put(before, "node_modules/@types/between/index.d.ts", between)
    project(before, { types: ["node", "between", "node-copy"] })
    installNode(after, "@types/node")
    put(after, "node_modules/@types/between/package.json", JSON.stringify({ name: "@types/between", version: "1.0.0", types: "index.d.ts" }))
    put(after, "node_modules/@types/between/index.d.ts", between)
    project(after, { types: ["node", "between"] })
  })
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.ok(diagnostics(result).some(text => text.startsWith("Ambient declaration load order differs")), JSON.stringify(result))
})

test("byte-identical copies over different dependencies stay an ambiguous origin", () => {
  const importing = 'declare module "stream" { import { Chunk } from "chunk-types"; export class Readable { read(): Chunk } }\n'
  const dependency = (at, text) => {
    put(at, "package.json", JSON.stringify({ name: "chunk-types", version: "1.0.0", types: "index.d.ts" }))
    put(at, "index.d.ts", text)
  }
  const result = compare((before, after) => {
    installNode(before, "@types/node", { stream: importing })
    installNode(before, "node-copy", { stream: importing })
    dependency(join(before, "node_modules/chunk-types"), "export type Chunk = string;\n")
    dependency(join(before, "node_modules/node-copy/node_modules/chunk-types"), "export type Chunk = number;\n")
    project(before, { types: ["node", "node-copy"] })
    installNode(after, "@types/node", { stream: importing })
    dependency(join(after, "node_modules/chunk-types"), "export type Chunk = string;\n")
    project(after, { types: ["node"] })
  })
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.ok(diagnostics(result).some(text => text.startsWith("Ambiguous ambient declaration origin: closure")), JSON.stringify(result))
})

test("copies that reach a JavaScript package outside the program compare it by bytes", () => {
  const reaching = 'declare module "stream" { export class Readable { read(): string } }\ndeclare module "node:punycode" { export * from "punycode"; }\n'
  const javascript = (at, text) => {
    put(at, "package.json", JSON.stringify({ name: "punycode", version: "2.3.1", main: "punycode.js" }))
    put(at, "punycode.js", text)
  }
  const build = copyText => (before, after) => {
    installNode(before, "@types/node", { stream: reaching })
    installNode(before, "node-copy", { stream: reaching })
    javascript(join(before, "node_modules/punycode"), "module.exports = 1\n")
    javascript(join(before, "node_modules/node-copy/node_modules/punycode"), copyText)
    project(before, { types: ["node", "node-copy"] })
    installNode(after, "@types/node", { stream: reaching })
    javascript(join(after, "node_modules/punycode"), "module.exports = 1\n")
    project(after, { types: ["node"] })
  }
  complete(compare(build("module.exports = 1\n")))
  const result = compare(build("module.exports = 2\n"))
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.ok(diagnostics(result).some(text => text.startsWith("Ambiguous ambient declaration origin: closure")), JSON.stringify(result))
})

test("a worker that exhausts its heap retries at the next size and reports the last failure", () => {
  const run = workerHeaps => {
    const root = mkdtempSync(join(tmpdir(), "api-identity-worker-heap-"))
    try {
      const before = join(root, "before"), after = join(root, "after")
      single(before); single(after)
      return compareApiIdentityInWorker(ts, before, after, { workerHeaps })
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  complete(run([16, 2048]))
  const exhausted = run([16, 32])
  assert.equal(exhausted.comparisonComplete, false, JSON.stringify(exhausted))
  assert.equal(exhausted.failure.stage, "worker", JSON.stringify(exhausted))
  assert.ok(exhausted.failure.signal || exhausted.failure.exitCode, JSON.stringify(exhausted))
})
