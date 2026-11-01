import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// vibelang --fix keeps a fix whose only effect on an error the program
// already reports is a more precise message (t3code: a schema helper's plain
// return type turned a test's existing TS2345 from Effect<brand<…>> into
// brand<…>, and the gate refused it 31 times). VIP-1 leaves an unannotated
// helper plain, so that fix is gone; EK4834's fix, try Effect.succeed(1) is 1,
// narrows a from number to 1 and drives the same gate.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(repo, "packages/runtime/node_modules/effect")
const missing = [native, effect].find((path) => !existsSync(path))
const skip = missing !== undefined && `build the native compiler and install packages/runtime first; missing ${missing}`

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-fix-gate-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true }, include: ["*.vibe"] }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  return root
}

test("--fix keeps EK4834's fix when it only rewrites an existing error's message", { skip }, (t) => {
  const main = "export effect function f() {\n  const a = try Effect.succeed(1)\n  const s: string = { v: a } as const\n  return s\n}\n"
  const root = project(t, { "main.vibe": main })
  const result = spawnSync(native, ["-p", "tsconfig.json", "--fix", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.doesNotMatch(result.stdout, /not fixed/, result.stdout + result.stderr)
  assert.match(readFileSync(join(root, "main.vibe"), "utf8"), /const a = 1\n/)
  // The error the program reported before the fix is still there, once, now naming 1.
  assert.equal(result.stdout.match(/main\.vibe\(3,9\): error TS2322: Type '\{ readonly v: 1; \}'/g)?.length, 1, result.stdout)
})

test("--fix still refuses a fix that reports an error where there was none", { skip }, (t) => {
  const ids = "export effect function getA() {\n  const a = try Effect.succeed(1)\n  return { v: a } as const\n}\n"
  const user = 'import { getA } from "./ids.vibe"\nexport effect function g() {\n  const n = try getA()\n  const m: typeof n = { v: 2 }\n  return m\n}\n'
  const root = project(t, { "ids.vibe": ids, "user.vibe": user })
  const result = spawnSync(native, ["-p", "tsconfig.json", "--fix", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.match(result.stdout, /ids\.vibe:\d+: EK4834 not fixed/, result.stdout + result.stderr)
  assert.match(readFileSync(join(root, "ids.vibe"), "utf8"), /const a = try Effect\.succeed\(1\)/)
})
