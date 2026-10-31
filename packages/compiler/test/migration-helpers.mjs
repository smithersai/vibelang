import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { fixToFixedPoint } from "../../../.smithers/flows/migrate/lib/codemod.mjs"

export const repo = fileURLToPath(new URL("../../../", import.meta.url))
export const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
export const fc = require("fast-check")
export const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
export const skip = [native, effect, join(runtime, "dist/index.js")].some(p => !existsSync(p)) && "build compiler and runtime first"

/** Exercise the production flow's fix loop, then execute both emitted modules. */
export async function migrationPair(t, source, code) {
  const spec = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
  assert.ok(spec.includes("A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"))
  const root = realpathSync(mkdtempSync(join(tmpdir(), "foldkit-migration-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true, types: [], outDir: "out" }, include: ["*.ts", "*.vibe"] }))
  writeFileSync(join(root, "control.ts"), 'import { Effect, Option, Match, pipe } from "effect"\n' + source)
  writeFileSync(join(root, "candidate.vibe"), source)
  const fixed = await fixToFixedPoint({ compiler: native, tsconfig: "tsconfig.json", cwd: root, root, only: ["candidate.vibe"] })
  assert.equal(fixed.settled, true)
  assert.ok(fixed.byFile["candidate.vibe"]?.[code] > 0, JSON.stringify(fixed))
  const text = readFileSync(join(root, "candidate.vibe"), "utf8")
  const emitted = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
  const original = await import(pathToFileURL(join(root, "out/control.js")))
  const changed = await import(pathToFileURL(join(root, "out/candidate.js")))
  const Option = await import(pathToFileURL(join(root, "node_modules/effect/dist/Option.js")))
  const again = await fixToFixedPoint({ compiler: native, tsconfig: "tsconfig.json", cwd: root, root, only: ["candidate.vibe"] })
  assert.deepEqual(again.byFile, {}, "migration is idempotent")
  return { original, changed, fixed, text, Option }
}
