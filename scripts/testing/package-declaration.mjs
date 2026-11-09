import * as apiInputs from "../../api-inputs.ts"
import * as buildContractInputs from "../../build-contract-inputs.ts"
import { readFileSync } from "node:fs"
import { stripTypeScriptTypes } from "node:module"
import { runInNewContext } from "node:vm"

const group = prefix => new Proxy({}, { get: (_, name) => prefix + "." + name })
const identity = spec => spec

// Inspect the real declaration with stable dependency identities. This adapter
// does not validate SDK behavior; build-declarations.test.mjs loads the real SDK.
export function declarationFixture(file, { env = {}, bindings = {}, source = readFileSync(new URL("../../" + file, import.meta.url), "utf8") } = {}) {
  const context = {
    ...apiInputs, ...buildContractInputs,
    fuzzTopics: new Map([["prelude", ["FuzzPreludeGlobalMember", "FuzzPreludeShadowed"]],
      ["migration", ["FuzzMigrationFormatterFixedPoint", "FuzzMigrationJSXRoutes"]]]),
    vibelangTopics: new Map([["inventory", ["TestInventoryFirst", "TestInventorySecond"]]]),
    migrationSources: { migrationSources: true },
    process: { env },
    S: { Generate: identity, Filegroup: identity, glob: identity, file: identity, Package: identity,
      Shell: { Build: identity, Test: identity, Run: identity }, Host: { bin: identity } },
    Tsc: group("tsc"), Packages: group("packages"), Typescript: group("typescript"), Vibelang: group("vibelang"),
    ...bindings
  }
  const script = stripTypeScriptTypes(source).replace(/^import \{([^}]+)\} from .*$/gm, (_, imports) => {
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
