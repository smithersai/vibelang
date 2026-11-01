import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
const { CaseCommands } = await import(process.env.CASE_COMMANDS_MODULE ?? new URL("../typescript/vibelang/harness-command.mjs", import.meta.url))
function active(pid) {
  try {
    if (process.platform === "linux") return readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] !== "Z"
    process.kill(pid, 0)
    return true
  } catch { return false }
}
function fixture(t, { hang = false, code = 0, pipes = "both", escape = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness tree "))
  const pidfile = join(root, "child.pid"), parentfile = join(root, "parent.pid")
  const descendant = [
    'require("node:fs").writeFileSync(' + JSON.stringify(pidfile) + ', String(process.pid))',
    'console.log("descendant stdout"); console.error("descendant stderr"); process.send("ready")',
    'setInterval(() => {}, 1000)',
  ].join("\n")
  const program = [
    'require("node:fs").writeFileSync(' + JSON.stringify(parentfile) + ', String(process.pid))',
    'const c = require("node:child_process").spawn(process.execPath, ["-e", ' + JSON.stringify(descendant) + '], {detached:' + escape + ',stdio:["ignore",' + ((pipes === "stderr" || pipes === "none") ? '"ignore"' : '"inherit"') + ',' + ((pipes === "stdout" || pipes === "none") ? '"ignore"' : '"inherit"') + ',"ipc"]})',
    'c.on("message", () => { console.log("parent ready"); ' + (hang ? "setInterval(() => {}, 1000)" : "process.exit(" + code + ")") + ' })'
  ].join("\n")
  t.after(() => {
    for (const file of [pidfile, parentfile]) {
      if (existsSync(file)) { try { process.kill(Number(readFileSync(file, "utf8")), "SIGKILL") } catch {} }
    }
    rmSync(root, { recursive: true, force: true })
  })
  const commands = new CaseCommands()
  return { commands, pidfile, run: () => commands.run(process.execPath, ["-e", program], { phase: "run", timeout: 4000 }) }
}
for (const [name, options] of [
  ["exited parent, inherited stdout", { pipes: "stdout" }],
  ["failed parent, inherited stderr", { code: 7, pipes: "stderr" }],
  ["living parent and descendant", { hang: true }],
  ["descendant in a separate process group", { escape: true }],
]) {
  test(name + ": resolves after its deadline", { skip: process.platform === "win32", timeout: 15_000 }, async t => {
    const f = fixture(t, options)
    let guard
    t.after(() => clearTimeout(guard))
    const result = await Promise.race([f.run(), new Promise(resolve => { guard = setTimeout(() => resolve(null), 8000) })])
    assert.ok(result, "command ignored its deadline while a descendant held pipes")
    assert.notEqual(result.code, 0, "an exited parent cannot turn a deadline into success")
    const record = f.commands.records[0]
    assert.equal(record.timedOut, true)
    assert.ok(record.pid > 0)
    assert.equal(record.processGroup, record.pid)
    assert.match(record.stdoutTail, /parent ready/)
    if (options.pipes !== "stderr") assert.match(record.stdoutTail, /descendant stdout/)
    if (options.pipes !== "stdout") assert.match(record.stderrTail, /descendant stderr/)
    assert.ok(Date.parse(record.finishedAt) >= Date.parse(record.deadline))
    assert.equal(record.exitCode, options.hang ? null : options.code ?? 0)
    assert.equal(record.signal, options.hang ? "SIGKILL" : null)
    if (!options.escape) {
      const pid = Number(readFileSync(f.pidfile, "utf8"))
      for (let n = 0; n < 40 && active(pid); n++) await new Promise(resolve => setTimeout(resolve, 25))
      assert.equal(active(pid), false, "owned descendant must be terminated")
    }
  })
}
test("ordinary success and error exits keep their code and separate tails", async () => {
  for (const code of [0, 1, 2, 7, 255]) {
    const commands = new CaseCommands()
    const result = await commands.run(process.execPath, ["-e", 'console.log("out"); console.error("err"); process.exit(' + code + ')'], { phase: "compile", timeout: 15_000 })
    assert.equal(result.code, code)
    assert.equal(result.stdout, "out\n")
    assert.equal(result.stderr, "err\n")
    assert.equal(commands.records[0].timedOut, false)
  }
})

test("successful commands clean descendants that close inherited output", { skip: process.platform === "win32", timeout: 15_000 }, async t => {
  const f = fixture(t, { pipes: "none" })
  const result = await f.run()
  assert.equal(result.code, 0)
  assert.equal(f.commands.records[0].timedOut, false)
  const pid = Number(readFileSync(f.pidfile, "utf8"))
  for (let n = 0; n < 40 && active(pid); n++) await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(active(pid), false, "completed commands must not leave owned background work")
})
