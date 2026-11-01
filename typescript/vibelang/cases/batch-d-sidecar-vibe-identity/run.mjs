import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { sidecarIdentity } from "../../sidecar-identity-fixture.mjs"
const result=sidecarIdentity("vibe",fileURLToPath(new URL("./node_modules",import.meta.url)),fileURLToPath(new URL("../../../built/local/tsc",import.meta.url)))
assert.equal(result.status,0,result.stdout+result.stderr)
console.log("one module")
