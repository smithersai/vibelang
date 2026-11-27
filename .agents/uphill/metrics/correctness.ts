import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { analyzeGoFile, emit, GO_PACKAGES, ROOT, walkFiles } from "./_lib.ts"

// 1. Version alignment against typescript/tsc/internal/vibelang/identity.go
const identity = readFileSync(join(ROOT, "typescript/tsc/internal/vibelang/identity.go"), "utf8")
const verMatch = identity.match(/const\s+Version\s*=\s*"([^"]+)"/)
if (!verMatch) throw new Error("Could not parse Version from identity.go")
const compilerVersion = verMatch[1]
const patch = compilerVersion.split(".")[2] ?? "0"
const expectedShimVersion = `7.1.${patch}`

const versionedPackages: Array<{ path: string; expected: string }> = [
  { path: "packages/compiler/package.json", expected: compilerVersion },
  { path: "packages/create-vibelang/package.json", expected: compilerVersion },
  { path: "packages/runtime/package.json", expected: compilerVersion },
  { path: "packages/unplugin/package.json", expected: compilerVersion },
  { path: "packages/vite/package.json", expected: compilerVersion },
  { path: "packages/typescript-shim/package.json", expected: expectedShimVersion }
]

for (const entry of versionedPackages) {
  const pkg = JSON.parse(readFileSync(join(ROOT, entry.path), "utf8")) as { version?: string }
  const ok = pkg.version === entry.expected
  emit("version-alignment", ok ? "pass" : "fail", {
    item: entry.path,
    note: ok ? undefined : `version ${pkg.version} !== expected ${entry.expected} (from identity.go)`
  })
}

// 2. Fast dependency-free repository integrity guards
const guards: Array<{ item: string; args: string[] }> = [
  { item: "projection-prelude", args: ["scripts/generate-projection-prelude.mjs", "--check"] },
  { item: "directive-readers", args: ["packages/compiler/generate-directive-readers.mjs", "--check"] },
  { item: "api-identity", args: ["scripts/sync-api-identity.mjs", "--check"] },
  { item: "release-history", args: ["docs/tools/release-history.mjs", "--check"] },
  { item: "lint-codes", args: ["docs/tools/lint-codes.mjs", "--check"] },
  { item: "tracked-leaks", args: ["docs/tools/check-tracked-leaks.mjs"] },
  { item: "case-collisions", args: ["docs/tools/check-case-collisions.mjs"] }
]

for (const guard of guards) {
  const res = spawnSync("node", guard.args, { cwd: ROOT, encoding: "utf8" })
  emit("repo-guards", res.status === 0 ? "pass" : "fail", {
    item: guard.item,
    note: res.status === 0 ? undefined : (res.stderr || res.stdout).trim().slice(0, 180)
  })
}

// 3. Production Go safety checks (no panic, no TODO/FIXME)
for (const pkg of GO_PACKAGES) {
  const prodGo = walkFiles(join(ROOT, pkg), ".go").filter((f) => !f.endsWith("_test.go"))
  if (prodGo.length === 0) continue

  let panicNote: string | undefined
  let todoNote: string | undefined
  for (const file of prodGo) {
    const stats = analyzeGoFile(file)
    if (!panicNote && stats.panicHit) panicNote = `${file}:${stats.panicHit.line}: panic() in production Go code`
    if (!todoNote && stats.todoHit) todoNote = `${file}:${stats.todoHit.line}: unresolved TODO/FIXME marker`
  }

  emit("go-no-panic", panicNote ? "fail" : "pass", { item: pkg, note: panicNote })
  emit("go-no-todo", todoNote ? "fail" : "pass", { item: pkg, note: todoNote })
}
