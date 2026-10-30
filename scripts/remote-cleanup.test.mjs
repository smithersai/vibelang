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
