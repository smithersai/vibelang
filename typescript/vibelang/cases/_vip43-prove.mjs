// run-seconds: 120
// Shared by the VIP-43 vibelang prove cases: projects in a temporary
// directory, a stand-in LemmaScript 0.6.6 package and Dafny 4.11.0 on PATH,
// and a prove runner whose output names no temporary path. The stand-in
// answers lsc info --typed with the Dafny names, writes P.dfy.gen and P.dfy
// with one member per lowered function, and records each lsc regen run in
// .lemmascript/runs.jsonl as LemmaScript does. FAKE_STAGE picks the stage it
// records, FAKE_INFO=reject fails lsc info, FAKE_DROP=<function> loses one of
// that function's obligations and FAKE_FLIP=<function> emits it as the other
// kind of member, for the audit. The stand-in dafny audit reports each
// {:axiom} and assume. The real toolchain proves what the cases print as
// proved.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const lsc = `
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
const args = process.argv.slice(2)
// The functions of a lowering file: the //@ ensures and //@ assert lines of
// each, and whether LemmaScript would emit a Dafny method for it: it has a
// let, a loop or an assert, or calls an impure extern or another method.
function functions(file) {
  const found = []
  const impure = new Set()
  let current
  let extern = false
  let pure = false
  for (const line of readFileSync(file, "utf8").split("\\n")) {
    const declared = /^declare function ([A-Za-z_$][\\w$]*)/.exec(line)
    const started = /^export function ([A-Za-z_$][\\w$]*)/.exec(line)
    if (line === "//@ extern") { extern = true; pure = false; current = undefined; continue }
    if (line === "//@ pure") { pure = true; continue }
    if (declared) { if (extern && !pure) impure.add(declared[1]); extern = false; continue }
    if (started) { current = { name: started[1], ensures: 0, asserts: 0, body: [] }; found.push(current); continue }
    if (!current) continue
    const text = line.trim()
    if (text.startsWith("//@ ensures ")) current.ensures++
    else if (text.startsWith("//@ assert ")) current.asserts++
    else if (!text.startsWith("//")) current.body.push(text)
  }
  const calls = (fn, name) => fn.body.some((text) => new RegExp("(^|[^\\\\w$.])" + name.replace("$", "\\\\$") + "\\\\(").test(text))
  for (const fn of found) fn.method = fn.asserts > 0 || fn.body.some((text) => /^(let |while\\b|for\\b)/.test(text)) || [...impure].some((name) => calls(fn, name))
  for (let changed = true; changed;) {
    changed = false
    for (const fn of found) {
      if (!fn.method && found.some((other) => other.method && other !== fn && calls(fn, other.name))) { fn.method = changed = true }
    }
  }
  return found
}
function dafny(file) {
  const lines = []
  for (const fn of functions(file)) {
    let { ensures, asserts } = fn
    if (process.env.FAKE_DROP === fn.name) ensures > 0 ? ensures-- : asserts--
    const method = process.env.FAKE_FLIP === fn.name ? !fn.method : fn.method
    if (method) {
      lines.push("method " + fn.name + "() returns (res: int)")
      for (let i = 0; i < ensures; i++) lines.push("  ensures true")
      lines.push("{")
      for (let i = 0; i < asserts; i++) lines.push("  assert true;")
      lines.push("}", "")
    } else {
      lines.push("function " + fn.name + "(): int", "{", "  0", "}", "")
      if (ensures > 0) {
        lines.push("lemma " + fn.name + "_ensures()")
        for (let i = 0; i < ensures; i++) lines.push("  ensures true")
        lines.push("{", "}", "")
      }
    }
  }
  return lines.join("\\n")
}
if (args[0] === "info" && args[1] === "--typed") {
  if (process.env.FAKE_INFO === "reject") { console.error("error: unsupported statement in " + args[2]); process.exit(1) }
  const fns = functions(args[2])
  console.log(JSON.stringify({ schema: 1, lemmascript: "0.6.6", file: args[2], functions: fns.map((fn) => ({ name: fn.name, isPure: !fn.method })), dafny: { emittedNames: Object.fromEntries(fns.map((fn) => [fn.name, fn.name])) } }, null, 2))
  process.exit(0)
}
const [command, backend, file] = args
if (command !== "regen" || backend !== "--backend=dafny") process.exit(2)
const stage = process.env.FAKE_STAGE ?? "ok"
const dfy = file.replace(/\\.ts$/, ".dfy")
const generated = dafny(file)
// As lsc regen does: the generation goes to P.dfy.gen, and to P.dfy unless
// P.dfy holds hand-written additions to the previous generation.
if (!existsSync(dfy) || !existsSync(dfy + ".gen") || readFileSync(dfy, "utf8") === readFileSync(dfy + ".gen", "utf8")) writeFileSync(dfy, generated)
writeFileSync(dfy + ".gen", generated)
const members = readFileSync(dfy, "utf8").split("\\n")
const failing = members.findIndex((line) => line.startsWith("method ")) + 2
if (stage === "verify") console.log(dfy + "(" + failing + ",10): Error: a postcondition could not be proved on this return path")
if (stage === "resolve") console.log(dfy + "(2,3): Error: unresolved identifier: helper")
mkdirSync(".lemmascript", { recursive: true })
appendFileSync(".lemmascript/runs.jsonl", JSON.stringify({ v: 1, cmd: "regen", file, stage, partial: false, failed: stage === "verify" ? ["total"] : [] }) + "\\n")
process.exit(stage === "ok" ? 0 : 1)
`

// The stand-in Dafny: its release, and for dafny audit one warning per
// {:axiom} attribute and assume statement of the file, as Dafny reports them.
const dafny = `#!/bin/sh
if [ "$1" = "audit" ]; then
  grep -n -E '\\{:axiom\\}|^[[:space:]]*assume ' "$2" | while IFS=: read -r line text; do
    echo "$2($line,1): Warning: this declaration or statement is an assumption: $(echo "$text" | sed 's/^ *//')"
  done
  exit 0
fi
echo 4.11.0+0000000
`

export function proveWorkspace(here) {
  const work = mkdtempSync(join(tmpdir(), "vip43-prove-"))
  const tools = join(work, "bin")
  mkdirSync(tools)
  writeFileSync(join(tools, "dafny"), dafny)
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
