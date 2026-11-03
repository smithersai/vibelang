import {checkTwin} from "../../test/coverage-twin.mjs"
import {fileURLToPath} from "node:url"
checkTwin(fileURLToPath(new URL(".",import.meta.url)))
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
assert.match(readFileSync(new URL("out/main.d.ts",import.meta.url),"utf8"),/interface \$Outcome\$Definition\$4\b/)
assert.match(readFileSync(new URL("out/main.d.ts",import.meta.url),"utf8"),/interface \$Box\$Definition extends[^\n]*WithGenerics<1>/)
const sidecar=readFileSync(new URL("main.d.vibe.ts",import.meta.url),"utf8")
assert.match(sidecar,/interface \$Outcome\$Definition\$4\b/)
assert.match(sidecar,/interface \$Box\$Definition extends[^\n]*WithGenerics<1>/)
console.log("twin types and Exit agree")
