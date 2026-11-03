import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

// Design 006-data.md: @internal belongs to the constant only. TypeScript
// itself leaves a dangling typeof alias after stripInternal. These fixtures
// check native emission and its diagnostics, rather than claiming a valid API.
export function stripInternalOutput(names) {
  const dir = process.cwd()
  const config = join(dir, "typescript/tsconfig.emit.json")
  const fork = spawnSync(process.env.VIBELANG_BINARY, ["-p", config, "--pretty", "false"], {
    encoding: "utf8", timeout: 30_000,
  })
  assert.ifError(fork.error)
  assert.equal(fork.status, 0, fork.stdout + fork.stderr)
  const raw = ts.readConfigFile(config, ts.sys.readFile)
  assert.equal(raw.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, join(dir, "typescript"))
  assert.deepEqual(parsed.errors, [])
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "stock tsc accepts the .ts twin")
  const emitted = new Map()
  const result = program.emit(undefined, (file, text) => emitted.set(relative(join(dir, "typescript/out"), file), text))
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.emitSkipped, false)
  const files = base => readdirSync(base, { recursive: true }).filter(file => /\.d\.ts$/.test(file)).sort()
  const native = files(join(dir, "out"))
  assert.deepEqual(native, files(join(dir, "typescript/out")))
  assert.deepEqual(native, [...emitted.keys()].filter(file => /\.d\.ts$/.test(file)).sort())
  for (const file of native) {
    const text = readFileSync(join(dir, "out", file), "utf8")
    assert.equal(text, readFileSync(join(dir, "typescript/out", file), "utf8"), file + ": compiler twin output")
    assert.equal(text, emitted.get(file), file + ": stock TypeScript output")
  }
  // Do not turn error-any into a passing semantic identity comparison.
  // Independently assert stock tsc's exact dangling-alias diagnostics.
  for (const base of ["out", "typescript/out"]) {
    const checked = ts.createProgram(native.map(file => join(dir, base, file)), {
      ...parsed.options, noEmit: true, skipLibCheck: false,
    })
    const diagnostics = ts.getPreEmitDiagnostics(checked)
      .filter(d => d.file && d.file.fileName.startsWith(resolve(dir, base) + "/"))
      .map(d => [d.code, ts.flattenDiagnosticMessageText(d.messageText, "\n")])
    assert.deepEqual(diagnostics, names.map(name => [2693,
      "'" + name + "' only refers to a type, but is being used as a value here."]), base)
  }
}
