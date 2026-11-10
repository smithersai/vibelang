// run-seconds: 120
// vibelang prove's protocol, with a stand-in LemmaScript and Dafny: the
// checks before any proof, the files it writes, the lsc run it starts and how
// it reads LemmaScript's run log. The real toolchain proves this program.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const work = mkdtempSync(join(tmpdir(), "vip43-prove-"))
const tools = join(work, "bin")
mkdirSync(tools)
writeFileSync(join(tools, "dafny"), "#!/bin/sh\necho 4.11.0+0000000\n")
chmodSync(join(tools, "dafny"), 0o755)

function project(name, sources, { lemmascript = true } = {}) {
  const dir = join(work, name)
  mkdirSync(dir)
  for (const file of ["tsconfig.json", "package.json"]) cpSync(join(here, file), join(dir, file))
  mkdirSync(join(dir, "node_modules"))
  for (const pkg of ["effect", "vibelang-runtime"]) symlinkSync(join(here, "node_modules", pkg), join(dir, "node_modules", pkg))
  for (const [file, text] of Object.entries(sources)) writeFileSync(join(dir, file), text)
  if (lemmascript) {
    const pkg = join(dir, "node_modules", "lemmascript")
    mkdirSync(pkg)
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "lemmascript", version: "0.6.6", bin: { lsc: "lsc.mjs" } }))
    // lsc regen --backend=dafny P.ts: record the run as LemmaScript 0.6.6 does.
    writeFileSync(join(pkg, "lsc.mjs"), `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
const [command, backend, file] = process.argv.slice(2)
if (command !== "regen" || backend !== "--backend=dafny") process.exit(2)
const stage = process.env.FAKE_STAGE ?? "ok"
writeFileSync(file.replace(/\\.ts$/, ".dfy"), "function sumTo(xs: int): int\\n{\\n  0\\n}\\n\\nmethod total(n: int) returns (res: int)\\n  ensures res == sumTo(n)\\n{\\n}\\n")
if (stage === "verify") console.log(file.replace(/\\.ts$/, ".dfy") + "(7,10): Error: a postcondition could not be proved on this return path")
if (stage === "resolve") console.log(file.replace(/\\.ts$/, ".dfy") + "(2,3): Error: unresolved identifier: helper")
mkdirSync(".lemmascript", { recursive: true })
appendFileSync(".lemmascript/runs.jsonl", JSON.stringify({ v: 1, cmd: "regen", file, stage, partial: false, failed: stage === "verify" ? ["total"] : [] }) + "\\n")
process.exit(stage === "ok" ? 0 : 1)
`)
  }
  return dir
}

function prove(dir, args = [], env = {}) {
  const r = spawnSync(process.env.VIBELANG_BINARY, ["prove", "-p", dir, ...args], {
    encoding: "utf8", timeout: 60000,
    env: { ...process.env, PATH: tools + ":" + process.env.PATH, ...env },
  })
  assert.ifError(r.error)
  return { status: r.status, text: (r.stdout + r.stderr).split(dir).join("<project>").split(work).join("<work>") }
}

const program = readFileSync(join(here, "main.vibe"), "utf8")
try {
  // Steps 1 and 2: the program is checked first, and no root needs no toolchain.
  const plain = project("plain", { "main.vibe": "export function f(n: number): number { return n }\n" }, { lemmascript: false })
  let r = prove(plain)
  assert.equal(r.status, 0, r.text)
  console.log("no root: " + r.text.trim())
  const broken = project("broken", { "main.vibe": "spec function f(n: number): number { return n }\nexport const g = f\n" })
  r = prove(broken)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4310:/)
  console.log("a compile error stops it: exit " + r.status)

  // Step 3: the pinned toolchain (EK4316).
  const bare = project("bare", { "main.vibe": program }, { lemmascript: false })
  r = prove(bare)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4316: vibelang prove can't run: lemmascript is not installed/)
  console.log("without lemmascript: EK4316")

  // Steps 4, 5 and 7: the proof directory, lsc regen and the run log.
  const proved = project("proved", { "main.vibe": program })
  r = prove(proved)
  assert.equal(r.status, 0, r.text)
  console.log(r.text.trimEnd())
  for (const file of ["lemmascript.json", "tsconfig.json", "main.vibe.ts"]) {
    console.log("--- proofs/" + file)
    console.log(readFileSync(join(proved, "proofs", file), "utf8").trimEnd())
  }
  r = prove(proved, [], { FAKE_STAGE: "verify" })
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4315: total is not proved: a postcondition could not be proved on this return path/)
  console.log("a failed obligation: EK4315 at total, both roots failed")
  r = prove(proved, [], { FAKE_STAGE: "resolve" })
  assert.match(r.text, /error EK4317: LemmaScript rejected the lowering of this module: unresolved identifier: helper/)
  console.log("a resolution error: EK4317")
  r = prove(proved, [], { FAKE_STAGE: "conflict" })
  assert.match(r.text, /error EK4318: main\.vibe\.dfy changes a generated line/)
  console.log("a conflicting P.dfy: EK4318")

  // The proof directory belongs to vibelang prove (EK4316).
  const foreign = project("foreign", { "main.vibe": program })
  mkdirSync(join(foreign, "proofs"))
  writeFileSync(join(foreign, "proofs", "notes.md"), "mine\n")
  r = prove(foreign)
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4316: .*holds files vibelang prove did not write/)
  console.log("a foreign proof directory: EK4316")

  // --strict refuses implicit trust (EK4319); a declare function stays trusted.
  const strict = project("strict", {
    "helper.ts": "export function scale(n: number): number { return n * 2 }\n",
    "main.vibe": 'import { scale } from "./helper.js"\ndeclare function pure(n: number): number\nspec function scaled(n: number): number { return scale(n) + pure(n) }\nexport function use(n: number): number {\n  proof { ensures((r) => r === scaled(n) - scaled(n) + n) }\n  return n\n}\n',
  })
  r = prove(strict)
  assert.equal(r.status, 0, r.text)
  console.log(r.text.trimEnd())
  r = prove(strict, ["--strict"])
  assert.equal(r.status, 1, r.text)
  assert.match(r.text, /error EK4319: scale comes from a TypeScript or JavaScript file/)
  assert.doesNotMatch(r.text, /EK4319: pure/)
  console.log("--strict: EK4319 at scale")

  r = prove(proved, ["extra.vibe"])
  assert.equal(r.status, 1, r.text)
  console.log("file arguments: " + r.text.split("\n")[0])
} finally {
  rmSync(work, { recursive: true, force: true })
}
