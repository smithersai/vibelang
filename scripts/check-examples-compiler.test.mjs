import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const source = process.env.VIBELANG_CHECK_EXAMPLES_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const names = ["hello", "users", "http-api", "file-tree", "resilience", "approval", "pipeline", "react-vite", "vue-vite", "svelte-vite", "foldkit-app", "alchemy-stack"]
const direct = names.slice(0, 7)
const selections = [
  { name: "native checkout only", native: true, expected: "native" },
  { name: "native checkout before PATH", native: true, path: true, expected: "native" },
  { name: "native checkout before legacy", native: true, legacy: true, expected: "native" },
  { name: "Windows native checkout only", native: true, windows: true, expected: "native" },
  { name: "Windows native checkout before PATH", native: true, windows: true, path: true, expected: "native" },
  { name: "PATH fallback", path: true, expected: "path" },
  { name: "legacy fallback", legacy: true, expected: "legacy" },
  { name: "PATH before legacy fallback", path: true, legacy: true, expected: "path" },
  { name: "nonexecutable native permits PATH fallback", native: "nonexecutable", path: true, expected: "path" },
  { name: "absolute override before checkout and PATH", native: true, path: true, override: "absolute", expected: "override" },
  { name: "relative override before checkout and PATH", native: true, path: true, override: "relative", expected: "override" },
  { name: "command override before checkout and PATH", native: true, path: true, override: "command", expected: "override" },
  { name: "missing explicit override is not replaced", native: true, override: "missing", expected: undefined }
]

for (const selection of selections) {
  test("example checker selects compiler: " + selection.name, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang examples compiler-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const put = (path, text, executable = false) => {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, text)
      if (executable) chmodSync(file, 0o755)
      return file
    }
    for (const script of ["check-examples.sh", "prepare-examples.mjs"]) {
      const file = put("scripts/" + script, "")
      cpSync(join(source, "scripts", script), file)
    }
    put("packages/runtime/package.json", JSON.stringify({ peerDependencies: { effect: "4.1.0" } }))
    for (const name of names) put("examples/" + name + "/package.json", JSON.stringify({ name }))
    put("examples/hello/expected-output.txt", "fixture\n")
    put("bin/npm", "#!" + process.execPath + `
import { writeFileSync } from "node:fs"
import { join } from "node:path"
writeFileSync(join(process.argv[process.argv.indexOf("--pack-destination") + 1], "runtime.tgz"), "fixture")
console.log("runtime.tgz")
`, true)
    put("bin/bun", "#!/bin/sh\nexit 0\n", true)
    // Isolate PATH from any global vibelang installation on the build host.
    symlinkSync(process.execPath, join(root, "bin/node"))
    const compiler = (path, name, executable = true) => {
      const core = put("tools/" + name + ".mjs", `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
appendFileSync(process.env.EXAMPLES_COMPILER_TRACE, JSON.stringify({ compiler: ${JSON.stringify(name)}, example: basename(process.cwd()), args: process.argv.slice(2) }) + "\\n")
mkdirSync("dist", { recursive: true })
writeFileSync("dist/main.js", "console.log(\\"fixture\\")\\n")
`)
      return put(path, "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(core) + ' "$@"\n', executable)
    }
    if (selection.native) compiler("packages/compiler/native/" + (selection.windows ? "vibelang.exe" : "vibelang"), "native", selection.native !== "nonexecutable")
    if (selection.path) compiler("bin/vibelang", "path")
    if (selection.legacy) compiler("typescript/built/local/tsc", "legacy")
    if (selection.windows) put("bin/uname", "#!/bin/sh\necho MINGW64_NT-fixture\n", true)
    const env = { ...process.env, PATH: join(root, "bin") + ":/usr/bin:/bin", EXAMPLES_COMPILER_TRACE: join(root, "calls.jsonl") }
    delete env.VIBELANG
    delete env.VIBELANG_BINARY
    if (selection.override) {
      const file = compiler("bin/override", "override")
      env.VIBELANG = { absolute: file, relative: "./bin/override", command: "override", missing: "./missing-compiler" }[selection.override]
    }
    const result = spawnSync("sh", [join(root, "scripts/check-examples.sh")], { cwd: root, env, encoding: "utf8" })
    if (selection.expected === undefined) {
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.equal((result.stdout.match(/^FAIL/gm) ?? []).length, direct.length)
      assert.match(result.stdout, /OK\s+alchemy-stack/)
      return
    }
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const calls = readFileSync(env.EXAMPLES_COMPILER_TRACE, "utf8").trim().split("\n").map(JSON.parse)
    assert.deepEqual(calls, direct.map(example => ({ compiler: selection.expected, example, args: ["-p", "."] })))
    assert.match(result.stdout, /OK\s+hello\s+compile and output/)
    assert.match(result.stdout, /OK\s+alchemy-stack/)
  })
}
