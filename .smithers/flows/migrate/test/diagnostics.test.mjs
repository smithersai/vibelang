import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { emitDeclarations } from "../lib/declarations.mjs"
import { check, newErrors, parseDiagnostics, styleProblems, summarize } from "../lib/diagnostics.mjs"

const output = `src/users.vibe(8,60): error EK1002: Effect.gen expects a JavaScript generator, but in VibeLang function* declares a producer.
  Write the body as an ordinary function: remove Effect.gen, function*, and yield*.
src/users.vibe(16,26): error EK4402: process.pid is platform code, which VibeLang code does not use directly.
  Use the experimental Process service:   Experimental.Process.pid()
src/users.vibe(3,1): warning EK4831: Users extends Context.Service; in VibeLang a service is a service declaration: service Users { … }.
src/other.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
error TS5096: Option 'allowImportingTsExtensions' can only be used when 'noEmit' or 'emitDeclarationOnly' is set.
`

test("parseDiagnostics reads file, position, category, code, message and notes", () => {
  const ds = parseDiagnostics(output, { cwd: "/repo/pkg", root: "/repo" })
  assert.equal(ds.length, 5)
  assert.deepEqual(ds[0], { file: "pkg/src/users.vibe", line: 8, column: 60, category: "error", code: "EK1002", message: "Effect.gen expects a JavaScript generator, but in VibeLang function* declares a producer.", notes: ["Write the body as an ordinary function: remove Effect.gen, function*, and yield*."] })
  assert.equal(ds[2].category, "warning")
  assert.deepEqual([ds[4].file, ds[4].code], [null, "TS5096"])
})

test("summarize splits the batch's diagnostics from the rest", () => {
  const ds = parseDiagnostics(output)
  const s = summarize(ds, ["src/users.vibe"])
  assert.deepEqual(s.batch, { errors: 2, warnings: 1, byCode: { EK1002: 1, EK4402: 1, EK4831: 1 } })
  assert.equal(s.other.errors, 2)
})

test("styleProblems are EK48xx and EK4402 in the given files only", () => {
  const ds = parseDiagnostics(output)
  assert.deepEqual(styleProblems(ds, ["src/users.vibe"]).map((d) => d.code), ["EK4402", "EK4831"])
  assert.deepEqual(styleProblems(ds, ["src/other.ts"]), [])
})

test("newErrors keeps a file's identity across the rename and counts repeats", () => {
  const before = parseDiagnostics("src/a.ts(1,1): error TS2322: X.\nsrc/a.ts(2,1): error TS2322: X.\n")
  const after = parseDiagnostics("src/a.vibe(1,1): error TS2322: X.\nsrc/a.vibe(3,1): error TS2322: X.\nsrc/a.vibe(4,1): error TS2322: X.\nsrc/a.vibe(5,1): warning EK4831: W.\n")
  assert.equal(newErrors(before, after).length, 1)
  assert.deepEqual(newErrors(after, before), [])
})

test("a compiler that dies is no clean run: check, the fix loop and the declaration step throw", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-crash-"))
  try {
    const fake = (name, body) => {
      const path = join(root, name)
      writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
      return path
    }
    const dies = /the compiler did not finish \(exit 2/
    const goCrash = fake("crash", "echo 'fatal error: concurrent map read and map write' >&2\necho >&2\necho 'goroutine 1 [running]:' >&2\nexit 2")
    const options = { tsconfig: "tsconfig.json", cwd: root, root }
    await assert.rejects(check({ compiler: goCrash, ...options }), dies)
    await assert.rejects(fixToFixedPoint({ compiler: goCrash, ...options }), dies)
    await assert.rejects(emitDeclarations({ compiler: goCrash, ...options, outDir: join(root, "out") }), dies)
    await assert.rejects(check({ compiler: fake("silent", "exit 2"), ...options }), dies)
    // A crash after a diagnostic is still a crash, and names itself.
    const late = fake("late", "echo 'a.ts(1,1): error TS2304: Cannot find name x.'\necho 'panic: oops'\nexit 2")
    await assert.rejects(check({ compiler: late, ...options }), /panic: oops/)
    await assert.rejects(check({ compiler: fake("killed", "kill -SEGV $$"), ...options }), /did not finish/)

    const reports = fake("reports", "echo 'a.ts(1,1): error TS2304: Cannot find name x.'\nexit 2")
    assert.equal((await check({ compiler: reports, ...options })).diagnostics.length, 1)
    assert.deepEqual((await check({ compiler: fake("clean", "exit 0"), ...options })).diagnostics, [])
    const fixes = fake("fixes", "echo 'vibelang --fix: 0 fixes in 0 files.'")
    assert.equal((await fixToFixedPoint({ compiler: fixes, ...options })).settled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("styleProblems holds a catch that can never run, which recovers in the TypeScript and throws in the .vibe", () => {
  const diagnostics = parseDiagnostics("src/a.vibe(2,3): warning EK9204: This catch can never run.\nsrc/b.vibe(2,3): warning EK9204: This catch can never run.\nsrc/a.vibe(3,3): warning EK9999: Other.\n")
  assert.deepEqual(styleProblems(diagnostics, ["src/a.vibe"]).map((d) => d.code), ["EK9204"])
})

test("styleProblems leaves a Context.Service class no service declaration can write, and rejects one it can", () => {
  const diagnostics = parseDiagnostics([
    "src/a.vibe(1,14): warning EK4831: Svc extends Context.Service; in VibeLang a service is a service declaration: service Svc { … }.",
    "  No quick fix: its members come from Shape; write them in the declaration.",
    "src/b.vibe(1,14): warning EK4831: Repo extends Context.Service; in VibeLang a service is a service declaration: service Repo { … }.",
    "  No quick fix: move its static members into the declaration.",
    "src/c.vibe(1,14): warning EK4831: Users extends Context.Service; in VibeLang a service is a service declaration: service Users { … }.",
    "  Its quick fix writes service Users { … }; vibelang --fix applies every such fix in the project.",
    "src/d.vibe(1,14): warning EK4830: Gone extends Data.TaggedError; in VibeLang an error is an error declaration: error Gone { … }.",
    "  No quick fix: the fields come from Fields.",
    ""
  ].join("\n"))
  const files = ["src/a.vibe", "src/b.vibe", "src/c.vibe", "src/d.vibe"]
  assert.deepEqual(styleProblems(diagnostics, files).map((d) => d.file), ["src/c.vibe", "src/d.vibe"])
})

test("styleProblems leaves a Schema.TaggedError class no schema error can write, and rejects one it can", () => {
  const diagnostics = parseDiagnostics([
    "src/a.vibe(2,14): warning EK4837: Failure extends Schema.TaggedError; in VibeLang it is a schema error declaration: schema error Failure { … }.",
    "  No quick fix: a schema error has no annotations argument.",
    "src/b.vibe(2,14): warning EK4837: Missing extends Schema.TaggedError; in VibeLang it is a schema error declaration: schema error Missing { … }.",
    "  Its quick fix writes schema error Missing { … }; vibelang --fix applies every such fix in the project.",
    ""
  ].join("\n"))
  assert.deepEqual(styleProblems(diagnostics, ["src/a.vibe", "src/b.vibe"]).map((d) => d.file), ["src/b.vibe"])
})

test("styleProblems leaves the Struct constant --fix must keep: a schema declaration would add a public type", () => {
  const diagnostics = parseDiagnostics("src/a.vibe(1,14): warning EK4832: Input holds a Schema.Struct.\nsrc/a.vibe(3,3): warning EK4831: Users extends Context.Service.\n")
  assert.deepEqual(styleProblems(diagnostics, ["src/a.vibe"]).map((d) => d.code), ["EK4831"])
})
