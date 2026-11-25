// run-seconds: 120
// VIP-43: vibe.proofDir, the directory vibelang prove writes to. A relative
// path uses the declaring config's directory, a leading ${configDir} the
// selected config's, and a wrong type is EK3007.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { proveWorkspace } from "../_vip43-prove.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const { project, prove, cleanup } = proveWorkspace(here)
const program = readFileSync(join(here, "main.vibe"), "utf8")
const base = JSON.parse(readFileSync(join(here, "tsconfig.json"), "utf8"))
const lowering = (dir, proofDir) => existsSync(join(dir, proofDir, "main.vibe.ts")) && existsSync(join(dir, proofDir, "main.vibe.dfy.gen"))
function configured(name, vibe, extra = {}) {
  const dir = project(name, { "main.vibe": program })
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...base, ...extra, vibe }))
  return dir
}
try {
  // The default: proofs in the selected config's directory.
  let dir = project("default", { "main.vibe": program })
  let r = prove(dir)
  assert.equal(r.status, 0, r.text)
  assert.ok(lowering(dir, "proofs"), r.text)
  console.log("default: proofs/main.vibe.ts")
  console.log(r.text.trimEnd())

  // A relative path uses the declaring config's directory.
  dir = configured("relative", { proofDir: "verification/dafny" })
  r = prove(dir)
  assert.equal(r.status, 0, r.text)
  assert.ok(lowering(dir, "verification/dafny"), r.text)
  assert.equal(existsSync(join(dir, "proofs")), false)
  console.log("\"verification/dafny\": verification/dafny/main.vibe.ts, and no proofs directory")

  // A leading ${configDir} uses the selected config's directory.
  dir = configured("template", { proofDir: "${configDir}/.proofs" })
  r = prove(dir)
  assert.equal(r.status, 0, r.text)
  assert.ok(lowering(dir, ".proofs"), r.text)
  console.log("\"${configDir}/.proofs\": .proofs/main.vibe.ts")

  // An extended config: its relative path stays in its own directory, and
  // its ${configDir} is the selected config's.
  for (const [name, proofDir, want] of [["extends-relative", "generated", "shared/generated"], ["extends-template", "${configDir}/generated", "generated"]]) {
    dir = project(name, { "main.vibe": program })
    mkdirSync(join(dir, "shared"))
    writeFileSync(join(dir, "shared", "tsconfig.base.json"), JSON.stringify({ vibe: { proofDir } }))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...base, extends: "./shared/tsconfig.base.json" }))
    r = prove(dir)
    assert.equal(r.status, 0, r.text)
    assert.ok(lowering(dir, want), r.text)
    assert.equal(existsSync(join(dir, "proofs")), false)
    console.log("extended config, " + JSON.stringify(proofDir) + ": " + want + "/main.vibe.ts")
  }

  // The selected config's own value wins over the extended one.
  dir = project("extends-override", { "main.vibe": program })
  mkdirSync(join(dir, "shared"))
  writeFileSync(join(dir, "shared", "tsconfig.base.json"), JSON.stringify({ vibe: { proofDir: "generated" } }))
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...base, extends: "./shared/tsconfig.base.json", vibe: { proofDir: "mine" } }))
  r = prove(dir)
  assert.equal(r.status, 0, r.text)
  assert.ok(lowering(dir, "mine"), r.text)
  assert.equal(existsSync(join(dir, "shared", "generated")), false)
  console.log("the selected config's proofDir wins: mine/main.vibe.ts")

  // A wrong type is EK3007, and nothing is written.
  for (const value of [3, true, null, ["proofs"], ""]) {
    dir = configured("wrong-" + JSON.stringify(value).replace(/[^a-z0-9]/g, "_"), { proofDir: value })
    r = prove(dir)
    assert.equal(r.status, 1, JSON.stringify(value) + "\n" + r.text)
    assert.match(r.text, /error EK3007: vibe\.proofDir must be a path string/)
    assert.equal(existsSync(join(dir, "proofs")), false)
  }
  console.log("a proofDir that is not a path string (3, true, null, an array, \"\"): error EK3007")

  // The proof directory checks apply to the configured directory (EK4316).
  dir = configured("foreign", { proofDir: "notes" })
  mkdirSync(join(dir, "notes"))
  writeFileSync(join(dir, "notes", "readme.md"), "mine\n")
  r = prove(dir)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4316: .*notes holds files vibelang prove did not write/)
  console.log("a proofDir with files vibelang prove did not write: EK4316")
  dir = configured("program", { proofDir: "." })
  r = prove(dir)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4316: .*holds the program file/)
  assert.equal(existsSync(join(dir, "main.vibe.ts")), false)
  console.log("a proofDir that holds a program file: EK4316")

  // The compiler accepts the option: it is no unknown vibe option.
  dir = configured("compiles", { proofDir: "proofs" })
  writeFileSync(join(dir, "main.vibe"), "export const one = 1\n")
  r = prove(dir)
  assert.equal(r.status, 0, r.text)
  console.log("no root: " + r.text.trim())
} finally {
  cleanup()
}
