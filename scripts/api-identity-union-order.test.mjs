// A union lists its members by type id, and each side creates its own types.
// dp-t3code-05 (infra/relay, 17 files): `Layer.Layer<DeliveryAttempts, never,
// Crypto.Crypto | RelayDb.RelayDb>` with a side's RelayDb listed the members
// in another order on each side, so the shared frontiers looked different and
// an error inside a dependency (drizzle's unresolved driver) refused an
// unchanged export. Errors a side owns, or a changed shared reach, still fail.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const compilerOptions = { lib: ["lib.es2015.d.ts"], module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowImportingTsExtensions: true, noEmit: true }
const shared = {
  "lib/package.json": '{"name":"lib","version":"1.0.0","types":"index.d.ts"}\n',
  "lib/index.d.ts": "export interface Layer<ROut, E, RIn> { readonly build: (r: RIn) => ROut }\nexport interface Crypto { readonly digest: (s: string) => string }\n",
  "orm/package.json": '{"name":"orm","version":"1.0.0","types":"index.d.ts"}\n',
  "orm/index.d.ts": 'import type { Pool } from "missing-driver";\nexport interface Database { readonly pool: Pool }\nexport interface Replica { readonly pool: Pool; readonly lag: number }\n',
}
const db = 'import type { Database } from "orm";\nexport declare class RelayDb { readonly db: Database }\n'
const layer = members => 'import type { Layer, Crypto } from "lib"; import type { RelayDb } from "./db.ts";\n' +
  "export declare class Attempts { readonly key: string }\nexport declare const layer: Layer<Attempts, never, " + members + ">;\n"
const write = (dir, files) => { for (const [name, text] of Object.entries(files)) { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text) } }
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-union-order-"))
  try {
    write(join(root, "node_modules"), shared)
    write(join(root, "before"), before)
    write(join(root, "after"), after)
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: { a: "a.d.ts" }, afterEntrypoints: { a: "a.d.ts" }, moduleRoots: [join(root, "node_modules")], compilerOptions })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("a union of a shared and a side's service compares an unchanged export identical", () => {
  for (const members of ["Crypto | RelayDb", "RelayDb | Crypto"]) {
    const files = { "a.d.ts": layer(members), "db.d.ts": db }
    const result = compare(files, files)
    assert.deepEqual(blockers(result), [], members + ": " + JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  }
})

test("the members written in another order are the same union", () => {
  const result = compare({ "a.d.ts": layer("Crypto | RelayDb"), "db.d.ts": db }, { "a.d.ts": layer("RelayDb | Crypto"), "db.d.ts": db })
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, true)
})

test("an error the side owns inside the union still refuses", () => {
  const owned = 'import type { Pool } from "missing-driver";\nexport declare class RelayDb { readonly pool: Pool }\n'
  const files = { "a.d.ts": layer("Crypto | RelayDb"), "db.d.ts": owned }
  const result = compare(files, files)
  assert.equal(result.comparisonComplete, false)
  assert.equal(result.identical, false)
})

test("a side that reaches another erroneous shared declaration is not identical", () => {
  const replica = 'import type { Replica } from "orm";\nexport declare class RelayDb { readonly db: Replica }\n'
  const result = compare({ "a.d.ts": layer("Crypto | RelayDb"), "db.d.ts": db }, { "a.d.ts": layer("Crypto | RelayDb"), "db.d.ts": replica })
  assert.equal(result.identical, false, JSON.stringify(result, null, 2))
})
