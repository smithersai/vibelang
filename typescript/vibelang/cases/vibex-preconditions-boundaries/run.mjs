import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { checkSyntaxTwin } from "../../test/census-vibex.mjs"
checkSyntaxTwin(import.meta.url)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const dir = fileURLToPath(new URL(".", import.meta.url))
const emitted = readFileSync(new URL("out/main.jsx", import.meta.url), "utf8")
assert.match(emitted, /class Timeout[\s\S]*<App\s*\/>/)
for (const file of ["trailing.vibex", "ambiguous.vibex"]) {
  const result = spawnSync(compiler, [file, "--jsx", "preserve", "--noCheck", "--noEmit", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stdout, /error TS\d+:/)
  if (file === "trailing.vibex") {
    assert.match(result.stdout, /error TS1005:/)
    assert.match(result.stdout, /error TS1381:/)
  }
}
const stock = join(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc")
const native = spawnSync(process.execPath, [stock, "reference/ambiguous.tsx", "--jsx", "preserve", "--noCheck", "--noEmit", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
assert.equal(native.status, 2, native.stdout + native.stderr)
assert.match(native.stdout, /error TS17008:/)
console.log("JSX parser boundaries PASS")
