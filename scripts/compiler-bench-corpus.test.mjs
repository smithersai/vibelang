import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

for (const mode of ["docs-1-empty", "docs-7-empty", "docs-1-partial", "docs-7-partial", "docs-0-complete"]) {
  const docsExit = mode.startsWith("docs-") ? Number(mode.split("-")[1]) : 0
  const partial = mode.endsWith("-partial")
  const complete = mode.endsWith("-complete")
  test((docsExit ? "compiler benchmark stops failed docs extraction: " : "compiler benchmark uses the requested build artifact: ") + mode, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang bench contract-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const put = (path, text) => {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      return target
    }
    const executable = (path, text) => {
      const file = put(path, text)
      chmodSync(file, 0o755)
      return file
    }
    for (const name of ["compiler.sh", "modules.sh", "measure.py", "gen-synthetic.mjs"]) {
      const target = join(root, "scripts/bench", name)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(source, "scripts/bench", name), target)
    }
    put("package.json", '{"type":"module"}')
    put("packages/runtime/dist/index.js", "")
    put("packages/runtime/node_modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
    const core = put("compiler.mjs", [
      'import { appendFileSync } from "node:fs"',
      'const args = process.argv.slice(3)',
      'appendFileSync(process.env.BENCH_CONTRACT_TRACE, JSON.stringify({ compiler: process.argv[2], args }) + "\\n")',
      'console.log(args.includes("--version") ? "VibeLang fixture" : "Files: 3\\nCheck time: 0.01s\\nTotal time: 0.02s")'
    ].join("\n"))
    const compiler = (path, name) => executable(path,
      "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(core) + " " + quote(name) + ' "$@"\n')
    const artifact = mode === "legacy" ? "typescript/built/local/tsc" : "packages/compiler/native/" + (mode === "windows-native" ? "vibelang.exe" : "vibelang")
    const nativeName = mode === "legacy" ? "legacy" : "native"
    compiler(artifact, nativeName)
    const override = compiler("alternate/compiler", "override")
    // Only documentation extraction is substituted; synthetic generation,
    // module staging, measurement and table rendering run their real scripts.
    const corpus = join(root, "docs-corpus")
    if (partial || complete) {
      put("docs-corpus/page/tsconfig.json", '{"files":["main.vibe"]}')
      put("docs-corpus/page/main.vibe", "export const n = 1\n")
    }
    const extractionOutput = docsExit || complete ? "fixture-snippets-progress\n" + (partial || complete ? "Temporary projects: " + corpus + "\n" : "") : ""
    executable("bin/bun", docsExit || complete
      ? "#!/bin/sh\nprintf '%s' " + quote(extractionOutput) + "\necho fixture-docs-failed >&2\nexit " + docsExit + "\n"
      : "#!/bin/sh\nexit 0\n")
    if (mode === "windows-native") executable("bin/uname", "#!/bin/sh\necho MINGW64_NT-fixture\n")
    const trace = join(root, "calls.jsonl")
    const env = { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH, BENCH_CONTRACT_TRACE: trace }
    delete env.VIBELANG
    if (mode === "override") env.VIBELANG = override
    const out = join(root, "output")
    const result = spawnSync("sh", [
      join(root, "scripts/bench/compiler.sh"), "--modules", "2", "--runs", "1", "--scale", "", "--out", out
    ], { cwd: root, encoding: "utf8", env })
    assert.equal(result.status, docsExit, result.stdout + result.stderr)
    assert.match(result.stdout, /synthetic 2 modules, VibeLang/)
    assert.match(result.stdout, /synthetic 2 modules, Effect TS, this compiler/)
    assert.equal(result.stdout.includes("working directory: " + out), !docsExit)
    if (docsExit) {
      assert.match(result.stderr, /fixture-docs-failed/)
      assert.ok(result.stderr.includes("docs corpus generation failed (exit " + docsExit))
      assert.ok(result.stderr.includes(join(out, "docs-corpus.log")))
      assert.equal(readFileSync(join(out, "docs-corpus.log"), "utf8"), extractionOutput)
      assert.ok(!result.stdout.includes("docs corpus as one program"))
      if (partial) assert.ok(existsSync(join(corpus, "page/tsconfig.json")), "retain partial extraction for inspection")
    }
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(calls.length, complete ? 4 : 3)
    const expected = mode === "override" ? "override" : nativeName
    assert.ok(calls.every(call => call.compiler === expected))
    assert.deepEqual(calls[0].args, ["--version"])
    assert.deepEqual(calls.slice(1, 3).map(call => call.args), ["vibelang", "effect-ts"].map(name => [
      "-p", join(out, "synth", name, "tsconfig.json"), "--extendedDiagnostics", "--pretty", "false"
    ]))
    for (const call of calls.slice(1, 3)) assert.ok(existsSync(call.args[1]))
    if (complete) {
      assert.match(result.stdout, /docs corpus as one program/)
      assert.deepEqual(calls[3].args, ["-p", join(corpus, "tsconfig.json"), "--extendedDiagnostics", "--pretty", "false"])
      assert.equal(existsSync(corpus), false, "successful extraction is cleaned up")
    }
  })
}
