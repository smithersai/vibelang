// t3code (drive-t3code 2026-11-04T02:06Z, codemod-gap:effect-diagnostics-directive-dead-after-conversion):
// a module renamed to .vibe kept its `// @effect-diagnostics-next-line` comments, but a .vibe build
// runs none of the Effect rules VibeLang answers itself (overriddenSchemaConstructor is EK4814,
// globalDate EK4403, effectSucceedWithVoid is not needed). Each comment printed TS377000, and
// client-runtime, contracts, provider-core, provider-cursor and source-control-bitbucket exited 2
// with no error. The codemod's `vibelang --fix` now rewrites them; this runs it on the minimized form.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))

const module = `export class BrowseError extends Schema.TaggedError<BrowseError>()("BrowseError", {
  message: Schema.String,
}) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: { readonly path: string }) {
    super({ message: \`Failed to browse \${props.path}\` } as any)
  }
}

export function stale(after: number): boolean {
  // @effect-diagnostics-next-line globalDate:off
  const now = after + 1
  return now > after
}

export const credential = (bytes: string | undefined) =>
  // @effect-diagnostics-next-line effectSucceedWithVoid:off - The SDK credential API requires undefined, not void.
  bytes ?? undefined
`

const want = `export class BrowseError extends Schema.TaggedError<BrowseError>()("BrowseError", {
  message: Schema.String,
}) {
  // @vibelang-diagnostics-next-line EK4814:off
  constructor(props: { readonly path: string }) {
    super({ message: \`Failed to browse \${props.path}\` } as any)
  }
}

export function stale(after: number): boolean {
  const now = after + 1
  return now > after
}

export const credential = (bytes: string | undefined) =>
  // The SDK credential API requires undefined, not void.
  bytes ?? undefined
`

function project() {
  const root = mkdtempSync(join(tmpdir(), "migrate-dead-directives-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("src/errors.vibe", module)
  put("package.json", '{"type":"module"}\n')
  // t3code's tsconfig.base.json sets the rules to error and no ignoreEffect*InTscExitCode.
  put("tsconfig.json", JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], lib: ["ESNext"], noEmit: true,
      plugins: [{ name: "@effect/language-service", diagnosticSeverity: { overriddenSchemaConstructor: "error", globalDate: "error", effectSucceedWithVoid: "error" } }],
    },
    files: ["src/errors.vibe"],
  }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(dirname(createRequire(join(runtime, "package.json")).resolve("effect/package.json")), join(root, "node_modules/effect"), "dir")
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
  return root
}

const check = root => spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8" })

test("t3code: the codemod's --fix rewrites the @effect-diagnostics comments the rename left with no effect", async () => {
  const root = project()
  try {
    const before = check(root)
    assert.equal((before.stdout.match(/TS377000/g) ?? []).length, 3, before.stdout)
    assert.equal(before.status, 2, "a dead directive is a warning that sets the exit status, as on t3code c5fefe9c431d")
    const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["src/errors.vibe"], timeoutMs: 120000 })
    assert.equal(readFileSync(join(root, "src/errors.vibe"), "utf8"), want)
    assert.equal(result.byFile["src/errors.vibe"]?.TS377000, 3, JSON.stringify(result.byFile))
    const after = check(root)
    assert.doesNotMatch(after.stdout, /TS377000|EK4814/, after.stdout)
    assert.equal(after.status, 0, after.stdout)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a directive that still suppresses a diagnostic stays as written", async () => {
  const root = project()
  try {
    const live = "// @effect-diagnostics-next-line effectSleepZeroToYieldNow:off\nexport const pause = Effect.sleep(0)\n"
    writeFileSync(join(root, "src/errors.vibe"), live)
    const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
    tsconfig.compilerOptions.plugins[0].diagnosticSeverity = { effectSleepZeroToYieldNow: "error" }
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(tsconfig))
    await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["src/errors.vibe"], timeoutMs: 120000 })
    assert.equal(readFileSync(join(root, "src/errors.vibe"), "utf8"), live)
    const after = check(root)
    assert.equal(after.status, 0, after.stdout)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
