// Keep requires visible to bundlers, and check the version before loading the ABI.
// This bridge needs no Node type declarations in compiler/mapper fixtures.
declare const require: (id: string) => unknown
declare const exports: object
// Bun cannot require version.js while the kernel's ES module graph evaluates it.
const versionGuard = require("./version-guard.cjs") as typeof import("./version-guard.cjs")
const effectPackage = require("effect/package.json") as { version: string }
versionGuard.checkEffectVersion(effectPackage.version)
// Bun can retain the original CommonJS exports object while loading the ESM graph.
const abi = Object.assign(exports, require("./core.js")) as typeof import("./core.js")
export = abi
