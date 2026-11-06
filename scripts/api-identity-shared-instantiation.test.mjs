// A shared generic applied to shared arguments is one type in one checker, so
// an error inside the dependency's declaration cannot hide a difference.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const dependency = 'import type * as Gone from "removed-module";\n' +
  "export interface Box<A, E, R> { readonly value: A; readonly error: E; readonly context: R }\n" +
  "export interface Session<R> { readonly relations: R; transaction<A, E, Q>(body: (tx: Session<R>) => Box<A, E, Q>): Box<A, E | Gone.Failure, Q> }\n" +
  "export type Db<R> = { readonly relations: R; readonly session: Session<R> };\n" +
  "export type Empty = Record<string, never>;\n"
const service = (argument, extra = "") => 'import type { Db, Empty } from "dep";\n' +
  extra + `export declare class Service { readonly db: Db<${argument}>; }\nexport declare const value: Service;\n`
const options = { strict: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }

function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-shared-instantiation-"))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  try {
    put("node_modules/dep/package.json", JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }))
    put("node_modules/dep/index.d.ts", dependency)
    put("before/index.d.ts", before)
    put("after/index.d.ts", after)
    const entry = { ".": "index.d.ts" }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      beforeEntrypoints: entry, afterEntrypoints: entry, compilerOptions: options })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("an equal shared instantiation over a broken dependency compares", () => {
  const result = compare(service("Empty"), service("Empty"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("different arguments to the same generic never compare identical", () => {
  const result = compare(service("Empty"), service("string"))
  assert.equal(result.identical, false, JSON.stringify(result))
})

test("a side's own argument stays unavailable over a broken dependency", () => {
  const local = "export interface Local { readonly id: string }\n"
  const result = compare(service("Local", local), service("Local", local))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
})
