// rule-evidence: docs/design/src/007-tooling.md#config-files
// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision
// opencode's packages/http-recorder build ran stock `bunx tsc
// --emitDeclarationOnly`, which ignores the tsconfig's @effect/language-service
// entry and exited 0. Setup replaced it with vibelang, whose only diagnostics
// were imported unstableApiUsage warnings, and the build exited 2, so the
// package's script/pack.ts failed. Setup now writes the plugin's own
// ignoreEffectWarningsInTscExitCode and ignoreEffectErrorsInTscExitCode into
// the entry when nothing patches the compiler (VIP-38 R3): vibelang honors
// them, so imported diagnostics stay out of the exit status and noEmitOnError
// and still print. As in @effect/tsgo, each option covers its own category.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-tsc-warnings-")))
const exitOptions = { ignoreEffectWarningsInTscExitCode: true, ignoreEffectErrorsInTscExitCode: true }
const witness = 'import { FileSystem } from "effect"\nexport const api = FileSystem.FileSystem\n'
const ownError = 'export const count: number = "one"\n'
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  mkdirSync(join(root, "src"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(root, "node_modules/effect"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  // packages/http-recorder/tsconfig.json's settings, without its extends.
  const config = (plugin = {}, extra = {}) => ({
    compilerOptions: {
      target: "ES2022", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true,
      types: [], rootDir: "src", outDir: "dist", declaration: true, ...extra,
      plugins: [{ name: "@effect/language-service", transform: "@effect/language-service/transform", namespaceImportPackages: ["effect", "@effect/*"], ...plugin }]
    },
    include: ["src"]
  })
  const invoke = (tsconfig, sources, command) => {
    rmSync(join(root, "dist"), { recursive: true, force: true })
    rmSync(join(root, "src"), { recursive: true, force: true })
    mkdirSync(join(root, "src"))
    for (const [name, text] of Object.entries(sources)) writeFileSync(join(root, "src", name), text)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(tsconfig))
    const r = spawnSync(binary, [...command, "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    return { status: r.status, output: r.stdout + r.stderr, declared: existsSync(join(root, "dist/index.d.ts")) }
  }

  // The witness: a patched repository without the options keeps VIP-38's policy; with them it exits as tsc did.
  const plain = invoke(config(), { "index.ts": witness }, ["--emitDeclarationOnly"])
  assert.equal(plain.status, 2, plain.output)
  assert.match(plain.output, /warning EK38130: unstableApiUsage/)
  const ignored = invoke(config(exitOptions), { "index.ts": witness }, ["--emitDeclarationOnly"])
  assert.equal(ignored.status, 0, ignored.output)
  assert.match(ignored.output, /warning EK38130: unstableApiUsage/, "the options must not hide the warning")
  assert.ok(ignored.declared, ignored.output)
  // Each option covers its own category only (@effect/tsgo): the errors option leaves a warning failing, and the warnings option an error.
  const errorsOnly = invoke(config({ ignoreEffectErrorsInTscExitCode: true }), { "index.ts": witness }, ["--emitDeclarationOnly"])
  assert.equal(errorsOnly.status, 2, errorsOnly.output)
  const warningsOnly = invoke(config({ ignoreEffectWarningsInTscExitCode: true, diagnosticSeverity: { unstableApiUsage: "error" } }), { "index.ts": witness }, ["--emitDeclarationOnly"])
  assert.equal(warningsOnly.status, 2, warningsOnly.output)

  // Mixes of imported severity, own errors and emit modes, with both options set.
  for (const severity of ["warning", "error", "suggestion"]) {
    for (const own of [false, true]) {
      for (const mode of [["--emitDeclarationOnly"], ["--noEmit"], ["-b", "."]]) {
        for (const noEmitOnError of [false, true]) {
          if (mode[0] === "--noEmit" && noEmitOnError) continue
          const tsconfig = config({ ...exitOptions, diagnosticSeverity: { unstableApiUsage: severity }, includeSuggestionsInTsc: true }, noEmitOnError ? { noEmitOnError: true } : {})
          const sources = own ? { "index.ts": witness, "own.ts": ownError } : { "index.ts": witness }
          const r = invoke(tsconfig, sources, mode)
          const label = JSON.stringify({ severity, own, mode, noEmitOnError, output: r.output })
          assert.equal(r.status === 0, !own, label)
          assert.match(r.output, /EK38130/, label)
          if (own) assert.match(r.output, /TS2322/, label)
          if (mode[0] !== "--noEmit") assert.equal(r.declared, !(own && noEmitOnError), label)
        }
      }
    }
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 34)
console.log("opencode tsc warnings-only exit: 34 checks passed")
