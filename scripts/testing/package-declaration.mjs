import * as rootShards from "../../root-test-shards.ts"
import * as apiInputs from "../../api-inputs.ts"
import * as buildContractInputs from "../../build-contract-inputs.ts"
import * as migrateInputs from "./migrate-shards.mjs"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { runInNewContext } from "node:vm"
import { createRequire } from "node:module"

const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
const identity = spec => spec

// Inspect the real declaration with stable dependency identities. This adapter
// does not validate SDK behavior; build-declarations.test.mjs loads the real SDK.
export function declarationFixture(file, { env = {}, bindings = {}, source = readFileSync(new URL("../../" + file, import.meta.url), "utf8") } = {}) {
  const context = {
    ...apiInputs, ...buildContractInputs, ...migrateInputs, ...rootShards,
    fuzzTopics: new Map([["prelude", ["FuzzPreludeGlobalMember", "FuzzPreludeShadowed"]],
      ["migration", ["FuzzMigrationFormatterFixedPoint", "FuzzMigrationJSXRoutes"]]]),
    vibelangTopics: new Map([["inventory", ["TestInventoryFirst", "TestInventorySecond"]]]),
    migrationSources: { migrationSources: true },
    process: { env },
    S: { Suite: identity, Generate: identity, Filegroup: identity, glob: identity, file: identity, Package: identity,
      Shell: { Build: identity, Test: identity, Run: identity }, Host: { bin: identity } },
    Tsc: group("tsc"), Packages: group("packages"), Typescript: group("typescript"), Vibelang: group("vibelang"),
    ...bindings
  }
  // The packages declaration also groups leaves in Suites and imports its test-name selector.
  context.S.Suite ??= identity
  // Load the selector only for a declaration that imports it: copied fixtures need not carry it.
  if (!("nodeTestSelection" in bindings) && /\bnodeTestSelection\b/.test(source))
    context.nodeTestSelection = createRequire(import.meta.url)("./node-selection.mjs").nodeTestSelection
  // A JSON module import binds the parsed file beside the declaration.
  const script = stripTypeScriptTypes(source).replace(/^import (\w+) from "(\.[^"]+\.json)" with \{ type: "json" \}$/gm, (_, name, path) => {
    context[name] = JSON.parse(readFileSync(new URL(path, new URL("../../" + file, import.meta.url)), "utf8"))
    return ""
  }).replace(/^import \{([^}]+)\} from .*$/gm, (_, imports) => {
    for (const imported of imports.split(",")) {
      const name = imported.trim().split(/\s+as\s+/).at(-1)
      if (context[name] === undefined) throw new Error(file + ": fixture has no binding for imported " + name)
    }
    return ""
  }).replace("export const Package", "globalThis.result")
  runInNewContext(script, context, { filename: file })
  return { targets: context.result.targets, evaluate: code => runInNewContext(code, context, { filename: file }) }
}

export function declarationTargets(...args) {
  return declarationFixture(...args).targets
}
