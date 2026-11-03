import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

function fixture(t, { diagnostic = "", header = "", identity = false, identityAfter, pending = false, expectedDiagnostics = false, runnerBinary = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness compile "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text, mode) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text, mode ? { mode } : undefined)
  }
  for (const file of ["harness.mjs", "harness-command.mjs"]) {
    put("typescript/vibelang/" + file, readFileSync(new URL("../typescript/vibelang/" + file, import.meta.url)))
  }
  const at = "typescript/vibelang/cases/sample"
  put(at + "/tsconfig.json", "{}")
  put(at + "/main.vibe", header + "\nexport const answer = 42\n")
  put(at + "/expected/stdout.txt", "42\n")
  if (runnerBinary) put(at + "/run.mjs", [
    'import assert from "node:assert/strict"',
    'import { resolve } from "node:path"',
    'assert.equal(process.env.VIBELANG_BINARY, resolve("../../../built/local/tsc"))',
    'console.log(42)',
  ].join("\n"))
  if (pending) put(at + "/pending", "fixture known failure\n")
  if (expectedDiagnostics) put(at + "/expected/diagnostics.txt", diagnostic.replace(/: [^:]*$/, "") + "\n")
  if (identity) {
    put(at + "/typescript/tsconfig.json", "{}")
    for (const file of ["api-identity.mjs", "api-identity-nominal.mjs"])
      put("scripts/" + file, readFileSync(new URL("./" + file, import.meta.url)))
    mkdirSync(join(root, "docs/tools/node_modules"), { recursive: true })
    symlinkSync(new URL("../docs/tools/node_modules/typescript", import.meta.url).pathname, join(root, "docs/tools/node_modules/typescript"))
  }
  put("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  put("modules/effect/package.json", '{"name":"effect","version":"4.1.1"}')
  put("runtime/dist/index.js", "")
  // Real child processes transport known artifacts; compiler semantics are
  // outside this tooling test. A native compiler witness is run separately.
  put("typescript/built/local/tsc", [
    "#!/usr/bin/env node",
    'import fs from "node:fs"',
    'fs.mkdirSync("out", { recursive: true })',
    'fs.writeFileSync("out/main.js", "console.log(42)")',
    'fs.writeFileSync("out/main.d.ts", "export declare const answer = 42;")',
    'const secondary = process.cwd().endsWith("/typescript")',
    'if (!secondary && process.env.FIXTURE_DECLARATION) fs.writeFileSync("out/main.d.ts", process.env.FIXTURE_DECLARATION)', 
    "if (!secondary) { console.log(" + JSON.stringify(diagnostic) + '); console.error("fixture compile stderr") }',
    "process.exit(secondary ? 0 : Number(process.env.FIXTURE_COMPILE_EXIT))",
  ].join("\n"), 0o755)
  put("typescript/package.json", '{"type":"module"}')
  const run = (code, args = []) => spawnSync(process.execPath, [join(root, "typescript/vibelang/harness.mjs"), "--jobs", "1", ...args, "sample"], {
    encoding: "utf8", timeout: 30_000, env: {
      ...process.env, FIXTURE_COMPILE_EXIT: String(code), FIXTURE_DECLARATION: identityAfter, EFFECT_NODE_MODULES: join(root, "modules"), VIBELANG_RUNTIME: join(root, "runtime")
    }
  })
  const log = result => {
    const file = /^log:\s+(.+)$/m.exec(result.stdout)?.[1] ?? /\(log: (.+)\)/.exec(result.stdout)?.[1]
    assert.ok(file, result.stdout + result.stderr)
    return JSON.parse(readFileSync(file, "utf8"))
  }
  return { run, log }
}

const warning = "main.vibe(1,1): warning EK4609: advisory fixture"
const error = "main.vibe(1,1): error EK0102: error fixture"
for (const [name, options] of [
  ["plain", {}], ["warnings", { diagnostic: warning }],
  ["expected warnings", { diagnostic: warning, expectedDiagnostics: true }],
  ["empty expected codes", { header: "// expect:" }],
  ["identity", { identity: true }],
]) {
  test(name + ": successful compile still passes", t => {
    const result = fixture(t, options).run(0)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  })
  for (const code of [1, 2, 7, 255]) {
    test(name + ": nonzero compile without errors fails (" + code + ")", t => {
      const f = fixture(t, options)
      const result = f.run(code)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stdout, new RegExp("tsc exited with " + code))
      const log = f.log(result)
      assert.equal(log.commands.length, 1, "must stop before declarations or execution")
      assert.equal(log.commands[0].exitCode, code)
      assert.equal(log.commands[0].phase, "compile")
      assert.match(log.commands[0].stderrTail, /fixture compile stderr/)
      assert.match(log.logTail, /fixture compile stderr/)
    })
  }
}
for (const code of [1, 2]) {
  test("expected error compile status " + code + " remains valid", t => {
    const result = fixture(t, { diagnostic: error, header: "// expect: EK0102", expectedDiagnostics: true }).run(code)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  })
  test("unexpected errors still fail with status " + code, t => {
    const result = fixture(t, { diagnostic: error }).run(code)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /tsc reported 1 error/)
  })
}
test("status output retains the failed compiler receipt", t => {
  const f = fixture(t)
  const result = f.run(2, ["--status"])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(f.log(result).commands[0].exitCode, 2)
})
test("a pending compile failure stays pending with evidence", t => {
  const f = fixture(t, { pending: true })
  const result = f.run(1)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /0 ok, 0 FAIL, 1 pending, 0 XPASS/)
  assert.equal(f.log(result).commands[0].exitCode, 1)
})
test("generated advisory categories never authorize nonzero success", t => {
  let state = 0x6901
  for (let i = 0; i < 24; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const category = ["warning", "message", "suggestion"][state % 3]
    const f = fixture(t, { diagnostic: "main.vibe(1,1): " + category + " EK4609: advisory " + state })
    const result = f.run(1 + state % 2)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.equal(f.log(result).commands.length, 1)
  }
})

test("declaration twins admit API-identical spelling", t => {
  const result = fixture(t, { identity: true, identityAfter: "export declare const answer: 42;" }).run(0)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
test("declaration twins reject a semantic change with tsc evidence", t => {
  const f = fixture(t, { identity: true, identityAfter: "export declare const answer: 43;" })
  const result = f.run(0)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  const log = f.log(result)
  assert.ok(log.commands.some(c => c.phase === "compare declarations"))
  assert.match(JSON.stringify(log), /TS2344/)
})

test("declaration twins distinguish unavailable comparisons from API differences", t => {
  const f = fixture(t, { identity: true, identityAfter: "export declare const answer: Missing;" })
  const result = f.run(0)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /declaration API comparison unavailable/)
  const log = f.log(result)
  assert.ok(log.commands.some(c => c.phase === "compare declarations" && c.exitCode === 2))
  assert.match(JSON.stringify(log), /Environment diagnostics/)
})

test("custom runners receive the exact compiler used by the harness", t => {
  const f = fixture(t, { runnerBinary: true })
  for (const args of [[], ["--isolated"]]) {
    const result = f.run(0, args)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 cases: 1 ok, 0 FAIL/)
  }
})
