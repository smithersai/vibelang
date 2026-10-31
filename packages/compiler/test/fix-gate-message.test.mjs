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
// brand<…>, and the gate refused it 31 times).
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

const helper = 'import * as Schema from "effect/Schema"\n' +
  "const makeThreadId = () => Schema.String.pipe(Schema.brand(\"ThreadId\"))\n" +
  'export const ThreadId = makeThreadId()\n'

test("--fix keeps a schema helper's plain return type when it only rewrites an existing error's message", { skip }, (t) => {
  const root = project(t, { "ids.vibe": helper, "user.vibe": 'import { ThreadId } from "./ids.vibe"\nexport const count: number = ThreadId\n' })
  const result = spawnSync(native, ["-p", "tsconfig.json", "--fix", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.doesNotMatch(result.stdout, /not fixed/, result.stdout + result.stderr)
  assert.match(readFileSync(join(root, "ids.vibe"), "utf8"), /const makeThreadId = \(\): /)
  // The error the program reported before the fix is still there, once.
  assert.equal(result.stdout.match(/user\.vibe\(2,14\): error TS2322/g)?.length, 1, result.stdout)
})

test("--fix still refuses a fix that reports an error where there was none", { skip }, (t) => {
  const user = 'import { Effect } from "effect"\nimport { ThreadId } from "./ids.vibe"\n' +
    'const needsEffect = (e: Effect.Effect<unknown>): string => "ok"\nexport const used: string = needsEffect(ThreadId)\n'
  const root = project(t, { "ids.vibe": helper, "user.vibe": user })
  const result = spawnSync(native, ["-p", "tsconfig.json", "--fix", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.match(result.stdout, /ids\.vibe:\d+: EK1001 not fixed/, result.stdout + result.stderr)
  assert.match(readFileSync(join(root, "ids.vibe"), "utf8"), /const makeThreadId = \(\) =>/)
})
