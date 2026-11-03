// run-seconds: 480
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"
const { Effect } = await import("effect")
const { verifyPlatformRepair } = await import("../../tests/coverage-platform-repair.mjs")
await verifyPlatformRepair(import.meta.url,"meta",Effect)

// Spec rule: docs/design/src/005-services.md#54665a5da4cdc781
// Chapter 005: fix-contract.
console.log("coverage-ok")
