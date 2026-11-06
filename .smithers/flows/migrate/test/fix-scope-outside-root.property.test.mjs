import assert from "node:assert/strict"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { fixProgramFiles } from "../lib/fix-scope.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")
const corpus = fileURLToPath(new URL("./fixtures/smithers-outside-root-scope", import.meta.url))
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "scope-outside-root-"))
  cpSync(corpus, root, { recursive: true })
  const put = (name, value) => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value) }
  return { root, project: join(root, "project"), put, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
const sources = f => [join(f.root, "shared/value.vibe"), join(f.root, "project/src/main.vibe")]
const diagnostic = (file, rootDir) => "error TS6059: File '" + file + "' is not under 'rootDir' '" + rootDir + "'. 'rootDir' is expected to contain all source files."
function fake(f, lines, files = sources(f)) {
  f.put("compiler.mjs", "#!/usr/bin/env node\nprocess.stdout.write(" + JSON.stringify([...files, ...lines].join("\n") + "\n") + ");process.exit(1);\n")
  chmodSync(join(f.root, "compiler.mjs"), 0o755)
  return join(f.root, "compiler.mjs")
}
test("a global rootDir diagnostic naming a listed source keeps its scope", async () => {
  const f = fixture()
  try {
    const log = join(f.root, "fix")
    const files = await fixProgramFiles({ compiler: fake(f, [diagnostic(sources(f)[0], join(f.project, "src"))]), tsconfig: "tsconfig.json", cwd: f.project, log })
    assert.deepEqual(files, sources(f))
    assert.match(readFileSync(log + ".scope.log", "utf8"), /"recoverableDiagnostics":\["TS6059"\]/)
  } finally { f.dispose() }
})
test("a malformed global rootDir message does not establish a scope", async () => {
  const f = fixture()
  try {
    f.put("unlisted.vibe", "export const absent = 1\n")
    await assert.rejects(fixProgramFiles({ compiler: fake(f, ["error TS6059: Cannot determine the source layout."]), tsconfig: "tsconfig.json", cwd: f.project }), /cannot determine/)
  } finally { f.dispose() }
})
test("property: physical and compiler-only source diagnostics recover; configuration and protocol failures remain failures", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.constantFrom("", "error TS5083: Cannot read file 'missing.json'.", "error TS6053: File 'missing.vibe' not found.", "truncated compiler output"), async (virtual, relativeName, extra) => {
    const f = fixture()
    try {
      f.put("unlisted.vibe", "export const absent = 1\n")
      const named = virtual ? sources(f)[0] + ".-54-ypes.ts" : sources(f)[0]
      const path = relativeName ? relative(f.project, named) : named
      const operation = fixProgramFiles({ compiler: fake(f, [diagnostic(path, join(f.project, "src")), ...(extra ? [extra] : [])]), tsconfig: "tsconfig.json", cwd: f.project })
      if (!extra) assert.deepEqual(await operation, sources(f))
      else await assert.rejects(operation, /cannot determine/)
    } finally { f.dispose() }
  }), { seed: 6059007, numRuns: 120 })
})
test("real compiler: source outside rootDir remains an error after discovery", async () => {
  assert.ok(existsSync(compiler), "provide the native compiler")
  const f = fixture()
  try {
    const listed = spawnSync(compiler, ["-p", "tsconfig.json", "--listFilesOnly", "--pretty", "false", "--singleThreaded"], { cwd: f.project, encoding: "utf8" })
    assert.equal(listed.status, 1)
    assert.match(listed.stdout + listed.stderr, /error TS6059:/)
    assert.doesNotMatch(listed.stdout + listed.stderr, /TS2307|TS5083/)
    const files = await fixProgramFiles({ compiler, tsconfig: "tsconfig.json", cwd: f.project, timeoutMs: 60000 })
    assert.deepEqual(new Set(files), new Set(sources(f)))
    const checked = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: f.project, encoding: "utf8" })
    assert.notEqual(checked.status, 0)
    assert.match(checked.stdout + checked.stderr, /error TS6059:/)
    console.log("rootDir twin statuses", JSON.stringify({ mode: "native", listed: listed.status, checked: checked.status }))
  } finally { f.dispose() }
})
test("stock TypeScript twin lists both sources and retains the rootDir error", () => {
  const f = fixture()
  try {
    for (const name of ["project/src/main", "shared/value"]) renameSync(join(f.root, name + ".vibe"), join(f.root, name + ".ts"))
    f.put("project/src/main.ts", readFileSync(join(f.root, "project/src/main.ts"), "utf8").replaceAll(".vibe", ".ts"))
    f.put("project/tsconfig.json", readFileSync(join(f.project, "tsconfig.json"), "utf8").replaceAll(".vibe", ".ts"))
    const stock = require.resolve("typescript/bin/tsc")
    const listed = spawnSync(process.execPath, [stock, "-p", "tsconfig.json", "--listFilesOnly", "--pretty", "false"], { cwd: f.project, encoding: "utf8" })
    assert.ok([0, 1].includes(listed.status))
    assert.match(listed.stdout, /shared[/\\]value\.ts/)
    assert.match(listed.stdout, /project[/\\]src[/\\]main\.ts/)
    const checked = spawnSync(process.execPath, [stock, "-p", "tsconfig.json", "--pretty", "false"], { cwd: f.project, encoding: "utf8" })
    assert.notEqual(checked.status, 0)
    assert.match(checked.stdout + checked.stderr, /error TS6059:/)
    console.log("rootDir twin statuses", JSON.stringify({ mode: "typescript", listed: listed.status, checked: checked.status }))
    assert.doesNotMatch(checked.stdout + checked.stderr, /TS2307|TS5083/)
  } finally { f.dispose() }
})
