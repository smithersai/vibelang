// Static JSON imports work in Node, Bun, and browser bundlers without Node APIs.
import effectPackage from "effect/package.json" with { type: "json" }
import versionGuard from "./version-guard.cjs"

// The pin is written here as a literal because repository tooling reads it from
// this file (the merge queue picks the Effect install that matches it).
// version-guard.cts holds the same literal for the CommonJS bridge, and
// tests/package.test.ts checks that the two agree.
export const PINNED_EFFECT_VERSION = "4.1.0"

versionGuard.checkEffectVersion(effectPackage.version)
