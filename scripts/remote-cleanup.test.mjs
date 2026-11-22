import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = fileURLToPath(new URL("./remote.sh", import.meta.url))

for (const mode of ["success", "initial-sync-failure", "tracked-sync-failure"]) {
  test("remote sync removes its temporary tracked-files list: " + mode, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang remote cleanup-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const workspace = join(root, "workspace")
    const bin = join(root, "bin")
    const temporary = join(root, "temporary")
    for (const dir of [join(workspace, ".jj"), join(workspace, "scripts"), bin, temporary]) mkdirSync(dir, { recursive: true })
    cpSync(source, join(workspace, "scripts/remote.sh"))
    const executable = (name, text) => {
      const file = join(bin, name)
      writeFileSync(file, text)
      chmodSync(file, 0o755)
    }
    const sshTrace = join(root, "ssh.jsonl")
    const rsyncTrace = join(root, "rsync.jsonl")
    executable("ssh", "#!" + process.execPath + "\n" +
      'require("node:fs").appendFileSync(process.env.REMOTE_SSH_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")\n')
    executable("rsync", "#!" + process.execPath + "\n" + [
      'const fs = require("node:fs")',
      'fs.appendFileSync(process.env.REMOTE_RSYNC_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")',
      'const count = fs.readFileSync(process.env.REMOTE_RSYNC_TRACE, "utf8").trim().split("\\n").length',
      'if (String(count) === process.env.REMOTE_FAIL_SYNC) process.exit(37)'
    ].join("\n"))
    executable("jj", '#!/bin/sh\n[ "$1" = file ] && [ "$2" = list ] || exit 91\nprintf "%s\\n" "fixture/node_modules/checked.txt"\n')
    // remote.sh creates its SSH control directory before synchronizing. The
    // fixture neither connects to a host nor touches the user's SSH directory.
    executable("mkdir", "#!/bin/sh\nexit 0\n")
    const env = {
      ...process.env,
      PATH: bin + delimiter + process.env.PATH,
      TMPDIR: temporary,
      ES_REMOTE_HOST: "fixture.invalid",
      ES_REMOTE_KEY: join(root, "unused-fixture-key"),
      REMOTE_SSH_TRACE: sshTrace,
      REMOTE_RSYNC_TRACE: rsyncTrace,
      REMOTE_FAIL_SYNC: mode === "initial-sync-failure" ? "1" : mode === "tracked-sync-failure" ? "2" : ""
    }
    const result = spawnSync("sh", [join(workspace, "scripts/remote.sh"), "true"], { cwd: workspace, env, encoding: "utf8" })
    assert.equal(result.status, mode === "success" ? 0 : 37, result.stdout + result.stderr)
    assert.deepEqual(readdirSync(temporary), [], "temporary tracked-files list leaked")
    const copies = readFileSync(rsyncTrace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(copies.length, mode === "initial-sync-failure" ? 1 : 2)
    if (copies.length === 2) assert.ok(copies[1].some(arg => arg.startsWith("--files-from=")))
    const sshCalls = readFileSync(sshTrace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(sshCalls.length, mode === "success" ? 2 : 1)
    assert.ok(sshCalls.every(args => args.includes("fixture.invalid")))
  })
}

test("remote.sh quotes workspace names and relative subdirectories containing spaces and shell metacharacters", t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-remote-quote-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspaceName = "work space;x"
  const subName = "sub dir;y"
  const workspace = join(root, workspaceName)
  const subdir = join(workspace, subName)
  const bin = join(root, "bin")
  const temporary = join(root, "temporary")
  const fakeHome = join(root, "home")
  for (const dir of [join(workspace, ".jj"), join(workspace, "scripts"), subdir, bin, temporary, join(fakeHome, "es-remote/work"), join(fakeHome, "es-remote", workspaceName, subName)]) {
    mkdirSync(dir, { recursive: true })
  }
  cpSync(source, join(workspace, "scripts/remote.sh"))
  const executable = (name, body) => {
    const file = join(bin, name)
    writeFileSync(file, body)
    chmodSync(file, 0o755)
  }
  const sshTrace = join(root, "ssh.jsonl")
  executable("ssh", "#!" + process.execPath + "\n" +
    'require("node:fs").appendFileSync(process.env.REMOTE_SSH_TRACE, JSON.stringify(process.argv.slice(2)) + "\\n")\n')
  executable("rsync", "#!/bin/sh\nexit 0\n")
  executable("jj", '#!/bin/sh\nexit 0\n')
  executable("mkdir", "#!/bin/sh\nexit 0\n")

  const env = {
    ...process.env,
    PATH: bin + delimiter + process.env.PATH,
    TMPDIR: temporary,
    ES_REMOTE_HOST: "fixture.invalid",
    ES_REMOTE_KEY: join(root, "unused-fixture-key"),
    REMOTE_SSH_TRACE: sshTrace
  }

  // 1. --clean must quote the workspace path so `;x` is not executed and `es-remote/work` is untouched.
  const clean = spawnSync("sh", [join(workspace, "scripts/remote.sh"), "--clean"], { cwd: subdir, env, encoding: "utf8" })
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  const cleanCmd = JSON.parse(readFileSync(sshTrace, "utf8").trim().split("\n")[0]).at(-1)
  const cleanExec = spawnSync("sh", ["-c", cleanCmd], { env: { ...process.env, HOME: fakeHome, PATH: "/usr/bin:/bin" }, encoding: "utf8" })
  assert.equal(cleanExec.status, 0, `clean command failed or executed metacharacter: ${cleanCmd}\n${cleanExec.stderr}`)
  assert.deepEqual(readdirSync(join(fakeHome, "es-remote")), ["work"], "only the exact workspace directory may be removed")

  // 2. Normal sync + run from a subdirectory with spaces/metacharacters must quote dest and rel in every SSH command.
  writeFileSync(sshTrace, "")
  const run = spawnSync("sh", [join(workspace, "scripts/remote.sh"), "true"], { cwd: subdir, env, encoding: "utf8" })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const sshCalls = readFileSync(sshTrace, "utf8").trim().split("\n").map(line => JSON.parse(line).at(-1))
  assert.equal(sshCalls.length, 2)
  const mkdirExec = spawnSync("sh", ["-c", sshCalls[0]], { env: { ...process.env, HOME: fakeHome, PATH: "/usr/bin:/bin" }, encoding: "utf8" })
  assert.equal(mkdirExec.status, 0, `mkdir command failed: ${sshCalls[0]}\n${mkdirExec.stderr}`)
  assert.deepEqual(readdirSync(join(fakeHome, "es-remote")).sort(), ["work", workspaceName].sort())
  mkdirSync(join(fakeHome, "es-remote", workspaceName, subName), { recursive: true })
  const runExec = spawnSync("sh", ["-c", sshCalls[1]], { env: { ...process.env, HOME: fakeHome, PATH: "/usr/bin:/bin" }, encoding: "utf8" })
  assert.equal(runExec.status, 0, `remote run command failed: ${sshCalls[1]}\n${runExec.stderr}`)
})
