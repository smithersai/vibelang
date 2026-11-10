// run-seconds: 120
// Shared by the VIP-43 vibelang prove cases: projects in a temporary
// directory, a stand-in LemmaScript 0.6.6 package and Dafny 4.11.0 on PATH,
// and a prove runner whose output names no temporary path. The stand-in
// records each lsc regen run in .lemmascript/runs.jsonl as LemmaScript does;
// FAKE_STAGE picks the stage it records. The real toolchain proves what the
// cases print as proved.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const lsc = `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
const [command, backend, file] = process.argv.slice(2)
if (command !== "regen" || backend !== "--backend=dafny") process.exit(2)
const stage = process.env.FAKE_STAGE ?? "ok"
const dfy = file.replace(/\\.ts$/, ".dfy")
writeFileSync(dfy, "function sumTo(xs: int): int\\n{\\n  0\\n}\\n\\nmethod total(n: int) returns (res: int)\\n  ensures res == sumTo(n)\\n{\\n}\\n")
if (stage === "verify") console.log(dfy + "(7,10): Error: a postcondition could not be proved on this return path")
if (stage === "resolve") console.log(dfy + "(2,3): Error: unresolved identifier: helper")
mkdirSync(".lemmascript", { recursive: true })
appendFileSync(".lemmascript/runs.jsonl", JSON.stringify({ v: 1, cmd: "regen", file, stage, partial: false, failed: stage === "verify" ? ["total"] : [] }) + "\\n")
process.exit(stage === "ok" ? 0 : 1)
`

export function proveWorkspace(here) {
  const work = mkdtempSync(join(tmpdir(), "vip43-prove-"))
  const tools = join(work, "bin")
  mkdirSync(tools)
  writeFileSync(join(tools, "dafny"), "#!/bin/sh\necho 4.11.0+0000000\n")
  chmodSync(join(tools, "dafny"), 0o755)
  function project(name, sources, { lemmascript = true, config = ["tsconfig.json", "package.json"] } = {}) {
    const dir = join(work, name)
    mkdirSync(dir)
    for (const file of config) cpSync(join(here, file), join(dir, file))
    mkdirSync(join(dir, "node_modules"))
    for (const pkg of ["effect", "vibelang-runtime"]) symlinkSync(join(here, "node_modules", pkg), join(dir, "node_modules", pkg))
    for (const [file, text] of Object.entries(sources)) writeFileSync(join(dir, file), text)
    if (lemmascript) {
      const pkg = join(dir, "node_modules", "lemmascript")
      mkdirSync(pkg)
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "lemmascript", version: "0.6.6", bin: { lsc: "lsc.mjs" } }))
      writeFileSync(join(pkg, "lsc.mjs"), lsc)
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
  return { project, prove, cleanup: () => rmSync(work, { recursive: true, force: true }) }
}
