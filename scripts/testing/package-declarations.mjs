// Evaluate the real declaration with inert constructors for command-contract tests.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
const require = createRequire(new URL("../../docs/tools/package.json", import.meta.url))
const ts = require("typescript")
import { nodeTestSelection } from "./node-selection.mjs"
import { migrateShards, migrateShardShell } from "./migrate-shards.mjs"
export function packageDeclarations(source = readFileSync(process.env.VIBELANG_PACKAGE_DECLARATION ?? new URL("../../packages/PACKAGE.ts", import.meta.url), "utf8"),
  inventory = JSON.parse(readFileSync(new URL("../../packages/test-inventory.json", import.meta.url), "utf8")),
  testBatches = JSON.parse(readFileSync(new URL("../../packages/test-batches.json", import.meta.url), "utf8"))) {
  const make = kind => attrs => ({ kind, ...attrs })
  const S = {
    file: path => ({ kind: "file", path }),
    glob: (path, options) => Array.isArray(path) ? path.map(path => ({ kind: "glob", path })) : ({ kind: "glob", path, ...options }),
    Filegroup: make("Filegroup"), Suite: make("Suite"), Package: attrs => attrs,
    Shell: { Build: make("Shell.Build"), Test: make("Shell.Test") },
    Host: { bin: name => ({ kind: "bin", name }) }
  }
  const text = source.replace(/^import .*\n/gm, "").replace("export const Package", "const Package")
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const testGroups = JSON.parse(readFileSync(new URL("../../packages/test-groups.json", import.meta.url), "utf8"))
  return Function("S", "inventory", "migrationSources", "Typescript", "Tsc", "testGroups", "nodeTestSelection", "testBatches", "migrateShards", "migrateShardShell", js + "\nreturn Package.targets")(
    S, inventory, { kind: "migrationSources" }, { compiler: { kind: "compiler" } },
    { srcs: { kind: "tsc" }, "go-vibelangfmt": { kind: "formatter" } }, testGroups, nodeTestSelection, testBatches, migrateShards, migrateShardShell)
}
