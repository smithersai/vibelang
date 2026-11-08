import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { batchScope, foreignChanges } from "../lib/touched.mjs"
import { must, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

// alchemy-platform-exported-value: an earlier toolchain's `vibelang --fix`
// moved a host read into a new companion beside its module, x.vibe's
// x.platform.ts. A recorded companion belongs to its batch, and a revert
// removes a companion that carries the compiler's marker.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
// The first line of every companion an earlier native repair wrote.
const compilerCompanionMarker = "// Generated platform helpers for this VibeLang module.\n"
const ts = require.resolve("typescript/package.json").replace(/\/package.json$/, "")

// The fake compiler reports its project's files.
const fakeCompiler = `#!/usr/bin/env node
const fs = require("node:fs")
if (process.argv.includes("--showConfig")) {
  const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf("-p") + 1], "utf8"))
  const files = config.files ?? fs.readdirSync("src").filter(f => /[.](ts|tsx|vibe|vibex)$/.test(f) && !f.includes(".d.")).map(f => "./src/" + f)
  console.log(JSON.stringify({ files, compilerOptions: config.compilerOptions ?? {} }))
  process.exit(0)
}
`

const wrapped = 'import * as Effect from "effect/Effect"\nexport const Value = Effect.sync(() => document.title)\n'

test("a recorded companion is in the batch's scope; an unrecorded one is foreign", () => {
  const files = [{ path: "src/value.ts", planned: "src/value.vibe" }]
  const recorded = { platform: { splits: [], refused: [], companions: [{ file: "src/value.ts", companion: "src/value.platform.ts" }] } }
  assert.ok(batchScope({ files, codemod: recorded }).has("src/value.platform.ts"))
  const added = [{ status: "added", path: "src/value.platform.ts" }]
  assert.deepEqual(foreignChanges(added, { files, codemod: recorded }), [])
  assert.deepEqual(foreignChanges(added, { files, codemod: { platform: { splits: [], refused: [] } } }), added)
})

for (const mode of ["step", "one-pass"]) test("revert removes a compiler companion an earlier toolchain wrote, " + mode, { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-compiler-companion-run-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (file, text) => { mkdirSync(join(target, file, ".."), { recursive: true }); writeFileSync(join(target, file), text) }
  try {
    put("src/value.ts", wrapped)
    put("src/plain.ts", "export const k = 1\n")
    put("package.json", JSON.stringify({ type: "module" }))
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", '{"compilerOptions":{"noEmit":true,"allowImportingTsExtensions":true},"include":["src/**/*"]}')
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original sources")
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(ts, join(target, "node_modules/typescript"))
    writeProbeAwareCompiler(join(target, "node_modules/.bin/vibelang"), fakeCompiler, { mode: 0o755 })
    writeJson(paths(run).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(paths(run).setup, {})
    writeJson(paths(run).plan, { ...(mode === "one-pass" ? { mode } : {}), batches: [{ files: ["src/value.ts", "src/plain.ts"] }] })
    const result = await codemod({ run })
    const changed = await Jj.changedPaths(target)
    assert.deepEqual(foreignChanges(changed, { files: result.files.map(path => ({ path, planned: path.replace(/\.ts$/, ".vibe") })), codemod: result }), [])
    // An earlier toolchain's fix can leave a companion no receipt names.
    put("src/plain.platform.ts", compilerCompanionMarker + "export function $platform() { return 1; }\n")
    await Jj.commit(target, "batch with companions")
    await revert({ run, batch: "01", file: "src/value.vibe", reason: "recorded companion" })
    assert.equal(readFileSync(join(target, "src/value.ts"), "utf8"), wrapped)
    assert.equal(existsSync(join(target, "src/value.platform.ts")), false)
    await revert({ run, batch: "01", file: "src/plain.vibe", reason: "stray companion" })
    assert.equal(readFileSync(join(target, "src/plain.ts"), "utf8"), "export const k = 1\n")
    assert.equal(existsSync(join(target, "src/plain.platform.ts")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
