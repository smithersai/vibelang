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
const evidence = fileURLToPath(new URL("out/fix-evidence/", import.meta.url))
mkdirSync(evidence, { recursive: true })
for (const name of ["local", "unnamed", "numeric"]) {
  const project = join(evidence, name)
  cpSync(new URL("input/" + name + "/", import.meta.url), project, { recursive: true })
  const fixed = spawnSync(compiler, ["-p", project, "--fix", "--noEmit", "--pretty", "false"], { encoding: "utf8" })
  assert.equal(fixed.error, undefined)
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  assert.match(readFileSync(join(project, "main.vibe"), "utf8"), /static readonly key = "/)
  const again = spawnSync(compiler, ["-p", project, "--fix", "--noEmit", "--pretty", "false"], { encoding: "utf8" })
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.match(again.stdout, /0 fixes in 0 files/)
}
console.log("explicit service key scopes validated")
