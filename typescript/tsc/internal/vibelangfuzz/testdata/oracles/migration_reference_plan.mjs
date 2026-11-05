import { createRequire } from "node:module"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
const root = process.cwd()
const require = createRequire(join(root, "packages/runtime/package.json"))
const ts = require("typescript")
const { refreshProjectReferences } = await import(pathToFileURL(join(root, ".smithers/flows/migrate/lib/reference-outputs.mjs")))
const corpus = JSON.parse(readFileSync(join(root, "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-reference-missing-child.json")))
let input = ""
for await (const chunk of process.stdin) input += chunk
const { key, mode } = JSON.parse(input)
mkdirSync(join(root, ".cache"), { recursive: true })
const temp = mkdtempSync(join(root, ".cache/reference-plan-"))
const saved = new Map()
const put = (name, value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  mkdirSync(dirname(join(temp, name)), { recursive: true })
  writeFileSync(join(temp, name), text)
  saved.set(name, text)
}
let executed = false, error = null, receipt = null
try {
  const owner = mode & 4 ? "apps/owned" : "owned"
  const vendor = mode & 2 ? "fixtures/vendor space-δ" : ".repos/vendor"
  const ownedConfig = owner + "/tsconfig.json", vendorConfig = vendor + "/tsconfig.json"
  const changed = owner + "/src/index." + (mode & 1 ? "vibe" : "ts")
  const ownedReference = key.startsWith("owned-") || key === "unsafe-output"
  const unsafe = key === "unsafe-output"
  put(changed, corpus.source)
  put(owner + "/out/keep.js", "keep-owned")
  put(vendor + "/out/keep.js", "keep-vendor")
  put(ownedConfig, {
    compilerOptions: { composite: true, declaration: true, outDir: unsafe ? "src" : "out", types: [] },
    files: ["src/" + changed.split("/").at(-1)],
    references: ownedReference ? [{ path: relative(owner, vendor) }] : []
  })
  if (unsafe) {
    put(vendor + "/main.ts", "export const dependency = 1;\n")
    put(vendorConfig, { compilerOptions: { composite: true, outDir: "out", types: [] }, files: ["main.ts"] })
  } else if (key.endsWith("transitive")) {
    put(vendorConfig, { files: [], references: [{ path: "./nested" }] })
    put(vendor + "/nested/tsconfig.json", { files: [], references: [{ path: "./missing" }] })
  } else put(vendorConfig, { files: [], references: [{ path: "./missing" }] })
  try {
    receipt = await refreshProjectReferences({
      root: temp, ts, configs: [ownedConfig, vendorConfig], changed: [changed], tracked: [changed],
      compiler: "unused", log: join(temp, "refresh.log"),
      execute: async () => { executed = true; throw Error("an invalid or independent graph executed a build") }
    })
  } catch (caught) { error = caught.message }
  console.log(JSON.stringify({
    error, state: receipt?.state ?? null, projects: receipt?.projects ?? null, executed,
    unchanged: [...saved].every(([name, text]) => readFileSync(join(temp, name), "utf8") === text)
  }))
} finally { rmSync(temp, { recursive: true, force: true }) }
