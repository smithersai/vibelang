// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { project,check,nativeCheck,run,codes,stock,repo } from "../../tests/coverage-tooling.mjs"

const result=run(process.execPath,["--test",path.join(repo,"docs/tools/platform-globals-inventory.test.mjs")],repo,{timeout:150_000})
assert.equal(result.status,0,result.output)
assert.doesNotMatch(result.output,/# SKIP/,"docs/tools dependencies must be installed for the pinned inventory check")

// Spec rule: docs/design/src/005-services.md#82c1e87e541d0da8
// Chapter 005: freshness.
console.log("coverage-ok")
