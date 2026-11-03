// run-seconds: 720
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"
const { Effect } = await import("effect")
const { verifyPlatformRepair } = await import("../../tests/coverage-platform-repair.mjs")
await verifyPlatformRepair(import.meta.url,"function",Effect)
await verifyPlatformRepair(import.meta.url,"method",Effect)

// Spec rule: docs/design/src/005-services.md#e558ec63848829b8
// Chapter 005: fix-contract.
console.log("coverage-ok")
