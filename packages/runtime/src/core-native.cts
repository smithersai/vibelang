// Keep requires visible to bundlers, and check the version before loading the ABI.
// This bridge needs no Node type declarations in compiler/mapper fixtures.
declare const require: (id: string) => unknown
// Bun cannot require version.js while the kernel's ES module graph evaluates it.
const versionGuard = require("./version-guard.cjs") as typeof import("./version-guard.cjs")
const effectPackage = require("effect/package.json") as { version: string }
versionGuard.checkEffectVersion(effectPackage.version)
const abi = require("./core.js") as typeof import("./core.js")
export = abi
