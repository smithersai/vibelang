// No repair writes dependencies, typeRoots, foreign native sources,
// declarations, emitted output, tsBuildInfoFile, lock files or other
// referenced projects, while the selected project's own source is fixed.
import assert from "node:assert/strict"
import { statSync } from "node:fs"
import { join } from "node:path"
import { project, baseOptions } from "../_tooling-witness.mjs"

const legacyType = 'import type { Effect } from "effect"\nexport type Run = Effect.Effect<number>\n'
const value = "export const value = 1\n"
// Each protected file holds text that an owned-source repair would rewrite.
const protectedFiles = {
  "node_modules/dep/index.vibe": legacyType,
  "node_modules/dep/package.json": '{"name":"dep","type":"module","types":"index.vibe","exports":{".":{"types":"./index.vibe","default":"./index.js"}}}',
  "types/extra/index.d.ts": 'declare type ExtraRun = import("effect").Effect.Effect<number>\n',
  "types/extra/package.json": '{"name":"extra","types":"index.d.ts"}',
  "src/foreign.ts": legacyType,
  "src/foreign-view.tsx": legacyType,
  "src/plain.js": value,
  "src/plain-view.jsx": value,
  "src/plain-module.mjs": value,
  "src/plain-common.cjs": "module.exports.value = 1\n",
  "src/declared.d.ts": "export declare const declared: number\n",
  "src/sidecar.d.vibe.ts": "export declare const sidecar: number\n",
  "src/sidecar-view.d.vibex.ts": "export declare const sidecarView: number\n",
  "bun.lock": "{ \"lockfileVersion\": 1 }\n",
  "package-lock.json": "{ \"lockfileVersion\": 3 }\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "yarn.lock": "# yarn lockfile v1\n",
  "lib/src/index.vibe": legacyType,
}
const owned = 'import type { Effect } from "effect"\n' +
  'import type { Run as Dep } from "dep"\n' +
  'import type { Run as Foreign } from "./foreign.js"\n' +
  'import type { Run as View } from "./foreign-view.js"\n' +
  'import { value as a } from "./plain.js"\nimport { value as b } from "./plain-view.jsx"\nimport { value as c } from "./plain-module.mjs"\n' +
  'import { declared } from "./declared.js"\n' +
  'import type { Run as Lib } from "../lib/src/index.js"\n' +
  "export type Both = Effect.Effect<number> | Dep | Foreign | View | Lib | ExtraRun\nexport const sum = a + b + c + declared\n"

const options = { ...baseOptions(), module: "NodeNext", allowJs: true, jsx: "preserve", typeRoots: ["./types"], types: ["extra"], incremental: true, tsBuildInfoFile: "cache/state.tsbuildinfo", rootDir: "src", outDir: "out", declaration: true }
const setup = ({ put, invoke }) => {
  for (const [file, text] of Object.entries(protectedFiles)) put(file, text)
  put("lib/tsconfig.json", { compilerOptions: { ...baseOptions(), composite: true, rootDir: "src", outDir: "build" }, include: ["src"] })
  put("tsconfig.json", { compilerOptions: options, include: ["src"], exclude: [], references: [{ path: "./lib" }] })
  // Build the referenced project first, so the selected one checks cleanly.
  const lib = invoke("-b", "lib", "--pretty", "false")
  assert.equal(lib.status, 0, lib.text)
}
const snapshot = (dir, read) => Object.fromEntries(Object.keys(protectedFiles).map(f => [f, [read(f), statSync(join(dir, f)).mtimeMs]]))

let fixedOwned, fixedOut, fixedInfo
project(({ dir, put, read, exists, invoke }) => {
  setup({ put, invoke })
  put("src/main.vibe", owned)
  // Emitted output and build info that exist before the run.
  const first = invoke("-p", ".", "--pretty", "false")
  assert.equal(first.status, 0, first.text)
  assert.match(first.text, /src\/main\.vibe\(\d+,\d+\): warning EK4833/, "the owned source has a repair to apply")
  // The dependency is in the program and has the same repair available.
  assert.match(first.text, /node_modules\/dep\/index\.vibe\(\d+,\d+\): warning EK4833/, first.text)
  const before = snapshot(dir, read)
  const r = invoke("--fix", "-p", ".", "--pretty", "false")
  assert.equal(r.status, 0, r.text)
  fixedOwned = read("src/main.vibe")
  assert.match(fixedOwned, /export type Both = \(number!!\) \|/, "the owned source is fixed")
  assert.deepEqual(snapshot(dir, read), before, "a protected file was written")
  fixedOut = ["main.js", "main.d.ts", "plain.js", "plain-common.cjs"].map(f => exists("out/" + f) ? read("out/" + f) : null)
  fixedInfo = read("cache/state.tsbuildinfo")
})
// The emitted output and build info are exactly what an ordinary compilation
// of the fixed source writes: the repair itself added nothing to them.
project(({ put, read, exists, invoke }) => {
  setup({ put, invoke })
  put("src/main.vibe", fixedOwned)
  const r = invoke("-p", ".", "--pretty", "false")
  assert.equal(r.status, 0, r.text)
  assert.deepEqual(["main.js", "main.d.ts", "plain.js", "plain-common.cjs"].map(f => exists("out/" + f) ? read("out/" + f) : null), fixedOut)
  assert.equal(read("cache/state.tsbuildinfo"), fixedInfo)
})
console.log("no repair writes dependencies, typeRoots, foreign sources, declarations, output, build info, locks or referenced projects")
