import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { fixProgramFiles } from "../lib/fix-scope.mjs"

// Smithers apps/mvp (rerun-smithers 2026-11-03 17:25Z): --listFilesOnly
// exited 1 with 40 EK0301 and 2 EK1702 in recorded .vibe files outside the
// batch. The scope needs only the file list, so no source-file diagnostic may
// stop discovery; a project the compiler cannot read still must.
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const config = { compilerOptions: { strict: true, noEmit: true, module: "preserve", target: "es2022", skipLibCheck: true }, include: ["src"] }
const sources = {
  "src/batch.ts": "export const one = 1\n",
  "src/recorded.vibe": "export effect function bindings() { const join = 1; return 0 }\nexport const first = effect <A, E, R>(get: A | undefined!E!R) => {\n  const value = try get\n  return value\n}\n",
  "src/other.vibe": "export const two = 2\n",
}
function fixture(tsconfig = JSON.stringify(config)) {
  const root = mkdtempSync(join(tmpdir(), "smithers-scope-outside-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", '{"type":"module"}')
  for (const [file, text] of Object.entries(sources)) put(file, text)
  put("tsconfig.json", tsconfig)
  return { root, put, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
const listed = f => [join(f.root, "src/other.vibe"), join(f.root, "src/recorded.vibe")]
function fake(f, lines, code = 1) {
  const stdout = ["bundled:///libs/lib.es2022.full.d.ts", join(f.root, "src/batch.ts"), ...listed(f), ...lines].join("\n") + "\n"
  f.put("compiler.mjs", "#!/usr/bin/env node\nprocess.stdout.write(" + JSON.stringify(stdout) + ");process.exit(" + code + ");\n")
  chmodSync(join(f.root, "compiler.mjs"), 0o755)
  return join(f.root, "compiler.mjs")
}
const ek1702 = "src/recorded.vibe(1,43): error EK1702: fork and join are reserved in effect code, so neither can name a variable, parameter or label here."
const ek0301 = "src/recorded.vibe(2,44): error EK0301: Parenthesize a union in an Effect slot."

test("EK1702 and EK0301 outside the batch still give the complete file list", async () => {
  const f = fixture()
  try {
    const log = join(f.root, "fix")
    assert.deepEqual(await fixProgramFiles({ compiler: fake(f, [ek1702, ek0301]), tsconfig: "tsconfig.json", cwd: f.root, log }), listed(f))
    assert.match(readFileSync(`${log}.scope.log`, "utf8"), /"recoverableDiagnostics":\["EK0301","EK1702"\]/)
  } finally { f.dispose() }
})

test("property: any mix of source-file errors keeps the list; any config or global error refuses it", async () => {
  const sourceError = fc.record({ file: fc.constantFrom("src/recorded.vibe", "src/other.vibe", "src/batch.ts"), code: fc.constantFrom("EK0301", "EK1702", "EK2001", "TS1005", "TS2322", "TS7006"), at: fc.nat(40) })
    .map(({ file, code, at }) => `${file}(${at + 1},${at + 2}): error ${code}: message ${at}.`)
  const configError = fc.constantFrom("tsconfig.json(1,55): error TS1005: ']' expected.", "error TS5083: Cannot read file 'tsconfig.json'.", "error TS6053: File 'src/missing.vibe' not found.")
  await fc.assert(fc.asyncProperty(fc.array(sourceError, { minLength: 1, maxLength: 8 }), fc.option(configError, { nil: undefined }), fc.nat(8), async (errors, bad, at) => {
    const lines = [...errors]
    if (bad) lines.splice(at % (lines.length + 1), 0, bad)
    const f = fixture()
    try {
      const operation = fixProgramFiles({ compiler: fake(f, lines), tsconfig: "tsconfig.json", cwd: f.root })
      if (bad) await assert.rejects(operation, /cannot determine the compiler's fix scope/)
      else assert.deepEqual(await operation, listed(f))
    } finally { f.dispose() }
  }), { seed: 1702301, numRuns: 120 })
})

const compiler = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")
function link(f) {
  mkdirSync(join(f.root, "node_modules"))
  const runtime = join(repo, "packages/runtime")
  symlinkSync(dirname(createRequire(join(runtime, "package.json")).resolve("effect/package.json")), join(f.root, "node_modules/effect"), "dir")
  symlinkSync(runtime, join(f.root, "node_modules/vibelang-runtime"), "dir")
}

test("real compiler: EK1702 and EK0301 in a recorded module outside the batch give the file list", async () => {
  assert.ok(existsSync(compiler), "build the native compiler for this regression")
  const f = fixture()
  try {
    link(f)
    const files = await fixProgramFiles({ compiler, tsconfig: "tsconfig.json", cwd: f.root, timeoutMs: 60000 })
    assert.deepEqual(files, listed(f))
  } finally { f.dispose() }
})

test("real compiler: a tsconfig it cannot parse still refuses the scope", async () => {
  assert.ok(existsSync(compiler), "build the native compiler for this regression")
  const f = fixture('{"compilerOptions":{"strict":true,}, "include":["src"')
  try {
    link(f)
    await assert.rejects(fixProgramFiles({ compiler, tsconfig: "tsconfig.json", cwd: f.root, timeoutMs: 60000 }), /cannot determine the compiler's fix scope \(exit 1\)[\s\S]*TS1005/)
  } finally { f.dispose() }
})
