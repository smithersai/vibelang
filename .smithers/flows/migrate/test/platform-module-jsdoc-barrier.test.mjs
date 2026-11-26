import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const options = {
  strict: true,
  allowImportingTsExtensions: true,
  declaration: true,
  emitDeclarationOnly: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  types: ["node"],
  typeRoots: [join(modules, "@types")]
}

const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

function emit(root, files) {
  put(root, "package.json", JSON.stringify({ type: "module", types: "dist/ClusterObject.d.ts" }))
  symlinkSync(modules, join(root, "node_modules"), "dir")
  for (const [name, text] of Object.entries(files)) put(root, "src/" + name, text)
  const program = ts.createProgram(Object.keys(files).map(name => join(root, "src", name)), {
    ...options,
    rootDir: join(root, "src"),
    outDir: join(root, "dist")
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  assert.equal(program.emit().emitSkipped, false)
}

function verifyPreservesModuleHeader(source) {
  const root = mkdtempSync(join(tmpdir(), "platform-jsdoc-barrier-"))
  try {
    const result = splitPlatform(source, "src/ClusterObject.ts", ts)
    assert.ok(result && !result.refused, result?.refused)
    emit(join(root, "before"), { "ClusterObject.ts": source })
    emit(join(root, "after"), {
      "ClusterObject.ts": result.module,
      "ClusterObject.platform.ts": result.platform
    })
    const comparison = compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      compilerOptions: { types: ["node"], typeRoots: [join(modules, "@types")], lib: ["lib.es2022.d.ts"] }
    })
    assert.equal(comparison.comparisonComplete, true, JSON.stringify(comparison))
    assert.deepEqual(comparison.docDifferences, [], JSON.stringify({
      module: result.module,
      beforeDts: readFileSync(join(root, "before/dist/ClusterObject.d.ts"), "utf8"),
      afterDts: readFileSync(join(root, "after/dist/ClusterObject.d.ts"), "utf8"),
      docDifferences: comparison.docDifferences
    }))
    assert.equal(comparison.identical, true, JSON.stringify(comparison))
    return result
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("#302: splitPlatform keeps module JSDoc detached from the first public interface when all imports move to sibling", () => {
  const withBlankLine = `/**
 * GCP ClusterObject resource module.
 * @module
 */

import { readFileSync } from "node:fs"

/** Properties for configuring a ClusterObject. */
export interface ClusterObjectProps {
  readonly name: string
}

export function loadCluster(file: string): string {
  return readFileSync(file, "utf8")
}
`
  const split = verifyPreservesModuleHeader(withBlankLine)
  assert.match(split.module, /GCP ClusterObject resource module/)
})

test("#302: splitPlatform keeps module JSDoc immediately above removed import detached from the first public interface", () => {
  const noBlankLine = `/**
 * GCP ClusterObject resource module.
 */
import { readFileSync } from "node:fs"

/** Properties for configuring a ClusterObject. */
export interface ClusterObjectProps {
  readonly name: string
}

export function loadCluster(file: string): string {
  return readFileSync(file, "utf8")
}
`
  const split = verifyPreservesModuleHeader(noBlankLine)
  assert.match(split.module, /GCP ClusterObject resource module/)
})

test("#302: splitPlatform preserves leading module JSDoc barrier when type imports move to sibling and head becomes empty", () => {
  const source = `/**
 * GCP ClusterObject resource module.
 */

import { type Dirent, readdirSync } from "node:fs"

/** Properties for configuring a ClusterObject. */
export interface ClusterObjectProps {
  readonly name: string
}

export const entries: readonly Dirent[] = readdirSync(".", { withFileTypes: true })
`
  const root = mkdtempSync(join(tmpdir(), "platform-jsdoc-empty-head-"))
  try {
    const result = splitPlatform(source, "src/ClusterObject.ts", ts, { reexports: true })
    assert.ok(result && !result.refused, result?.refused)
    emit(join(root, "before"), { "ClusterObject.ts": source })
    emit(join(root, "after"), {
      "ClusterObject.ts": result.module,
      "ClusterObject.platform.ts": result.platform
    })
    const comparison = compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      compilerOptions: { types: ["node"], typeRoots: [join(modules, "@types")], lib: ["lib.es2022.d.ts"] }
    })
    assert.equal(comparison.comparisonComplete, true, JSON.stringify(comparison))
    assert.deepEqual(comparison.docDifferences, [], JSON.stringify({
      module: result.module,
      beforeDts: readFileSync(join(root, "before/dist/ClusterObject.d.ts"), "utf8"),
      afterDts: readFileSync(join(root, "after/dist/ClusterObject.d.ts"), "utf8"),
      docDifferences: comparison.docDifferences
    }))
    assert.equal(comparison.identical, true, JSON.stringify(comparison))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
