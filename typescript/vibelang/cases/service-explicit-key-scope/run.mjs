// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { cpSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Root, Keys, localKey } from "./out/main.js"
assert.equal(Root.key, "service-explicit-key-scope/main#Root")
assert.equal(Keys.Global.key, "service-explicit-key-scope/main#Global")
assert.equal(localKey(), "literal/Local")
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
for (const [name, count] of [["local",2], ["unnamed",1], ["numeric",1]]) {
  const project = fileURLToPath(new URL("input/" + name + "/tsconfig.json", import.meta.url))
  const checked = spawnSync(compiler, ["-p", project, "--noEmit", "--pretty", "false"], {encoding:"utf8"})
  assert.equal(checked.error, undefined)
  const output = checked.stdout + checked.stderr
  assert.notEqual(checked.status, 0, name + ": " + output)
  const diagnostics = [...output.matchAll(new RegExp("^.*[(][0-9]+,[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
  assert.equal(diagnostics.length, count, output)
  assert(diagnostics.every(m => m[1] === "EK" && Number(m[2]) === 903), output)
}
console.log("explicit service key scopes validated")
