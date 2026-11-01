import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"

function fixture(t, cases = true) {
  const root = mkdtempSync(join(tmpdir(), "harness jobs "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, text, mode) => {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text, mode ? { mode } : undefined)
  }
  for (const file of ["harness.mjs", "harness-command.mjs"]) {
    put("typescript/vibelang/" + file, readFileSync(new URL("../typescript/vibelang/" + file, import.meta.url)))
  }
  const harness = join(root, "typescript/vibelang/harness.mjs")
  const trace = join(root, "calls")
  // Only the compiler transport is a fixture. Each invocation is recorded;
  // the real harness must recognize the expected diagnostic and count it.
  put("typescript/built/local/tsc", '#!/bin/sh\nprintf "%s\\n" "$PWD" >> "$JOBS_TRACE"\nprintf "main.vibe(1,1): error EK9999: fixture\\n"\nexit 1\n', 0o755)
  put("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  if (cases) {
    for (const name of ["first", "second"]) {
      put("typescript/vibelang/cases/" + name + "/tsconfig.json", "{}")
      put("typescript/vibelang/cases/" + name + "/main.vibe", "// expect: EK9999\n")
      put("typescript/vibelang/cases/" + name + "/out/keep", "keep")
      put("typescript/vibelang/cases/" + name + "/node_modules/keep", "keep")
    }
  }
  const run = (args) => spawnSync(process.execPath, [harness, ...args], {
    encoding: "utf8", timeout: 30_000, env: {
      ...process.env, EFFECT_NODE_MODULES: join(root, "modules"),
      VIBELANG_RUNTIME: join(root, "runtime"), JOBS_TRACE: trace
    }
  })
  const untouched = () => {
    assert.equal(existsSync(trace), false, "invalid jobs must not invoke the compiler")
    assert.equal(existsSync(join(root, "typescript/.cache")), false, "no failure evidence for a CLI error")
    for (const name of ["first", "second"]) {
      for (const sub of ["out", "node_modules"]) {
        assert.deepEqual(readdirSync(join(root, "typescript/vibelang/cases", name, sub)), ["keep"])
      }
    }
  }
  return { root, harness, trace, run, untouched }
}

const invalid = ["0", "-1", "-8", "NaN", "Infinity", "-Infinity", "1.5", "0.5",
  "9007199254740992", "1e100", "", " ", "no", "1x"]
for (const value of invalid) test("harness rejects invalid --jobs " + JSON.stringify(value), t => {
  const f = fixture(t)
  const result = f.run(["--jobs", value])
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /harness.mjs: --jobs.*positive safe integer/)
  assert.doesNotMatch(result.stdout, /cases:/)
  f.untouched()
})

for (const args of [["--jobs"], ["--jobs", "--verbose"], ["--jobs", "--status"]]) {
  test("harness rejects missing --jobs value: " + args.join(" "), t => {
    const f = fixture(t)
    const result = f.run(args)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.match(result.stderr, /--jobs.*positive safe integer/)
    f.untouched()
  })
}

test("invalid jobs fail before case directory discovery", t => {
  const f = fixture(t, false)
  const result = f.run(["--jobs", "0"])
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stderr, /--jobs.*positive safe integer/)
  assert.doesNotMatch(result.stderr, /ENOENT/)
})

for (const value of [undefined, "1", "2", "8", "02", "2e0", String(Number.MAX_SAFE_INTEGER)]) {
  test("valid jobs execute each selected case once: " + (value ?? "default"), t => {
    const f = fixture(t)
    const result = f.run(value === undefined ? [] : ["--jobs", value])
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /2 cases: 2 ok, 0 FAIL/)
    assert.deepEqual(readFileSync(f.trace, "utf8").trim().split("\n").map(p => p.split("/").at(-1)).sort(), ["first", "second"])
  })
}

test("generated negative and fractional job counts never execute a case", t => {
  const f = fixture(t)
  for (let i = 0; i < 32; i++) {
    const value = String(i % 2 === 0 ? -i : i + 0.25)
    const result = f.run(["--jobs", value])
    assert.equal(result.status, 2, value + ": " + result.stdout + result.stderr)
    assert.match(result.stderr, /--jobs.*positive safe integer/)
    f.untouched()
  }
})
