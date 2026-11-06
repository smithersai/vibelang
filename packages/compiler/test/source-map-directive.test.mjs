// The compiler ends each emitted file with its source map directive, which
// vibelang/project removes, because a loader or bundler plugin hands the map
// over separately. Only that last line is the directive.
import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function compile(t, source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-directive-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(effect, join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], lib: ["ES2022"] },
    include: ["*.vibe"]
  }))
  writeFileSync(join(root, "main.vibe"), source)
  const result = compileProjectSync({ project: join(root, "tsconfig.json"), cache: false })
  assert.deepEqual(result.errors, [])
  return result.outputs.get(join(root, "main.vibe")).code
}

const cases = [
  ["a template literal's line", 'export const text = `first\n//# sourceMappingURL=keep\nlast`\n', "//# sourceMappingURL=keep"],
  ["a string", 'export const text = "//# sourceMappingURL=keep"\n', '"//# sourceMappingURL=keep"'],
  ["a comment", '// //# sourceMappingURL=keep\nexport const text = 1\n', "//# sourceMappingURL=keep"]
]

for (const [name, source, kept] of cases) {
  test(`${name} that spells a directive stays in the emitted JavaScript`, { skip }, (t) => {
    const code = compile(t, source)
    assert.ok(code.includes(kept), code)
    // The directive of the emitted file, which names a map no loader serves, goes.
    assert.ok(!code.includes("main.js.map"), code)
  })
}
