import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// The first program of the VibeLang skill is what an agent copies first, and it
// leans on VIP-6's globals (`scoped`) and VIP-14's modules. It compiles and runs
// as written, against the real @effect/platform-node, with no edit.
const packageDirectory = fileURLToPath(new URL("..", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(packageDirectory, "native/vibelang")
const runtimeModules = join(packageDirectory, "../runtime/node_modules")
const skip = !existsSync(native)
  ? `run sh scripts/build-vibelang.sh first; missing ${native}`
  : !existsSync(join(runtimeModules, "@effect/platform-node")) && `install packages/runtime first; missing ${runtimeModules}`

const firstProgram = () => {
  const skill = readFileSync(join(packageDirectory, "skills/vibelang/SKILL.md"), "utf8")
  const block = /^```vibe\n([\s\S]*?)^```$/m.exec(skill)
  assert.ok(block, "SKILL.md has a vibe program")
  return block[1]
}

test("the skill's first program compiles and prints its greeting", { skip }, (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-skill-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        lib: ["esnext"],
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        types: [],
        skipLibCheck: true,
        outDir: "out"
      },
      include: ["*.vibe"]
    })
  )
  writeFileSync(join(root, "main.vibe"), firstProgram())
  // A project installs effect, its platform package and vibelang-runtime.
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtimeModules, "effect"), join(root, "node_modules/effect"))
  symlinkSync(join(runtimeModules, "@effect"), join(root, "node_modules/@effect"))
  symlinkSync(join(packageDirectory, "../runtime"), join(root, "node_modules/vibelang-runtime"))
  const compiled = spawnSync(native, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const { NAME: _unset, ...env } = process.env
  const ran = spawnSync(process.execPath, [join(root, "out/main.js")], { cwd: root, encoding: "utf8", env, timeout: 30_000 })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  assert.equal(ran.stdout, "Hello, stranger!\n")
})
