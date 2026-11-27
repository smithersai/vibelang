// Static JSON imports work in Node, Bun, and browser bundlers without Node APIs.
import effectPackage from "effect/package.json" with { type: "json" }
import versionGuard from "./version-guard.cjs"

// The tested Effect baseline and supported semver range are written here as
// literals because repository tooling reads them from this file.
// version-guard.cts holds the same literals for the CommonJS bridge, and
// tests/package.test.ts checks that the two agree.
export const PINNED_EFFECT_VERSION = "4.1.6"
export const SUPPORTED_EFFECT_RANGE = "^4.1.0"

versionGuard.checkEffectVersion(effectPackage.version)
