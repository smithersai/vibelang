import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { appendFileSync, chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_CHECK_EXAMPLES_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const names = ["hello", "users", "http-api", "file-tree", "resilience", "approval", "pipeline", "react-vite", "vue-vite", "svelte-vite", "foldkit-app", "alchemy-stack"]
const modes = [
  ["success", 0, /OK\s+alchemy-stack\s+bun run test/],
  ["install", 1, /FAIL\s+hello\s+install/],
  ["compile", 1, /FAIL\s+hello\s+compile/],
  ["compile-file-tree-2", 1, /FAIL\s+file-tree\s+compile/],
  ["compile-pipeline-42", 1, /FAIL\s+pipeline\s+compile/],
  ["compile-http-api-127", 1, /FAIL\s+http-api\s+compile/],
  ["tests", 1, /FAIL\s+users\s+tests/],
  ["framework", 1, /FAIL\s+react-vite\s+typecheck, tests or build/],
  ["run", 1, /FAIL\s+hello\s+run/],
  ["output", 1, /FAIL\s+hello\s+output/]
]
for (const [mode, status, message] of modes) {
  test(`example checker preserves ${mode} results and continues checking the other examples`, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-example-contract-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const put = (path, text) => {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      return target
    }
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const script of ["check-examples.sh", "prepare-examples.mjs"]) cpSync(join(source, "scripts", script), join(root, "scripts", script))
    put("packages/runtime/package.json", JSON.stringify({ peerDependencies: { effect: "4.1.1" } }))
    for (const name of names) {
      put(`examples/${name}/package.json`, JSON.stringify({ name, ...(name === "users" ? { scripts: { test: "fixture" } } : {}) }))
      if (name !== "http-api") put(`examples/${name}/expected-output.txt`, "fixture\n")
    }
    const command = (name, body) => {
      const target = put("bin/" + name, "#!" + process.execPath + "\n" + body)
      chmodSync(target, 0o755)
      return target
    }
    command("npm", `import { writeFileSync } from "node:fs"
import { join } from "node:path"
const dir = process.argv[process.argv.indexOf("--pack-destination") + 1]
writeFileSync(join(dir, "runtime.tgz"), "fixture")
console.log("runtime.tgz")
`)
    command("bun", `import { basename } from "node:path"
const name = basename(process.cwd())
const mode = process.env.EXAMPLES_CONTRACT_MODE
if ((mode === "install" && name === "hello" && process.argv[2] === "install") ||
    (mode === "tests" && name === "users" && process.argv[2] === "run") ||
    (mode === "framework" && name === "react-vite" && process.argv[2] === "run")) process.exitCode = 7
`)
    const compiler = command("compiler", `import { mkdirSync, writeFileSync } from "node:fs"
import { basename } from "node:path"
const first = basename(process.cwd()) === "hello"
const mode = process.env.EXAMPLES_CONTRACT_MODE
const target = mode === "compile" ? "hello" : mode.startsWith("compile-") ? mode.slice(8, mode.lastIndexOf("-")) : ""
if (basename(process.cwd()) === target) {
  process.stdout.write("OMITTED_PREFIX" + "x".repeat(20000) + "\\n")
  if (mode !== "compile-file-tree-2") for (let i = 0; i < 90; i++) process.stdout.write("old compiler context " + i + "\\n")
  process.stderr.write("fixture compiler failed for " + target + "\\n")
  process.exit(mode === "compile" ? 7 : Number(mode.slice(mode.lastIndexOf("-") + 1)))
}
mkdirSync("dist", { recursive: true })
const output = first && mode === "output" ? "wrong" : "fixture"
writeFileSync("dist/main.js", first && mode === "run" ? "process.exit(7)" : "console.log(" + JSON.stringify(output) + ")")
`)
    const result = spawnSync("sh", [join(root, "scripts/check-examples.sh")], {
      cwd: root, encoding: "utf8", env: { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH, VIBELANG: compiler, EXAMPLES_CONTRACT_MODE: mode }
    })
    if (process.env.EXAMPLES_CONTRACT_RECORD) appendFileSync(process.env.EXAMPLES_CONTRACT_RECORD, JSON.stringify({ mode, status: result.status, stdout: result.stdout, stderr: result.stderr }) + "\n")
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.match(result.stdout, message)
    assert.equal((result.stdout.match(/^FAIL/gm) ?? []).length, mode === "success" ? 0 : 1)
    if (!mode.startsWith("compile-http-api-")) assert.match(result.stdout, /OK\s+http-api\s+compile \(long-running server/)
    assert.match(result.stdout, /OK\s+alchemy-stack\s+bun run test/)
    assert.doesNotMatch(result.stdout, /BROKEN|XPASS/)
    if (mode.startsWith("compile")) {
      const code = mode === "compile" ? 7 : Number(mode.slice(mode.lastIndexOf("-") + 1))
      const target = mode === "compile" ? "hello" : mode.slice(8, mode.lastIndexOf("-"))
      assert.match(result.stdout, new RegExp("compile \\(exit " + code + ";"))
      assert.ok(result.stderr.includes(target + " compile exited " + code), result.stderr)
      assert.ok(result.stderr.includes("fixture compiler failed for " + target), result.stderr)
      assert.doesNotMatch(result.stderr, /OMITTED_PREFIX|old compiler context 0\n/)
      assert.ok(Buffer.byteLength(result.stderr) < 9000, "central failure diagnostics stay bounded")
    }
  })
}
