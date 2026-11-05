import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `build the compiler and runtime first; missing ${missing}`

function project(t, file, source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-is-home-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" },
    files: [file]
  }))
  writeFileSync(join(root, file), source)
  return root
}

function compile(root, ...args) {
  return spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
}

for (const keyword of ["let", "const"]) {
  test(`--fix braces a ${keyword} is binding and preserves the TypeScript twin`, { skip }, (t) => {
    const source = `export function ids() {
  const xs: unknown[] = [{ id: 1 }, { id: 2 }, {}]
  const out: (() => unknown)[] = []
  for (const x of xs) if (x is { id: ${keyword} id }) out.push(() => id)
  return out.map(f => f())
}
`
    const root = project(t, "main.vibe", source)
    const before = compile(root, "--noEmit")
    assert.notEqual(before.status, 0)
    assert.match(before.stdout, /EK0705/)
    const repaired = compile(root, "--fix")
    assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr)
    const fixed = readFileSync(join(root, "main.vibe"), "utf8")
    assert.equal(fixed, source.replace(`for (const x of xs) if (x is { id: ${keyword} id }) out.push(() => id)`, `for (const x of xs) { if (x is { id: ${keyword} id }) out.push(() => id) }`))
    const again = compile(root, "--fix", "--noEmit")
    assert.equal(again.status, 0, again.stdout + again.stderr)
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
    assert.match(again.stdout, /0 fixes in 0 files/)

    const twin = project(t, "main.ts", source.replace(`for (const x of xs) if (x is { id: ${keyword} id }) out.push(() => id)`, `for (const x of xs) { if (typeof x === "object" && x !== null && "id" in x) { ${keyword} id = x.id; out.push(() => id) } }`))
    const checked = compile(twin)
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    // VIP-27, amended 2026-11-04: the stock twin stays as written; the emitted
    // declaration adds exactly the generated @throws {never} output contract.
    assert.equal(readFileSync(join(root, "out/main.d.ts"), "utf8"), `/** @throws {never} */\n${readFileSync(join(twin, "out/main.d.ts"), "utf8")}`)
    for (const dir of [root, twin]) {
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(pathToFileURL(join(dir, "out/main.js")).href)}); console.log(JSON.stringify(m.ids()))`], { cwd: dir, encoding: "utf8", timeout: 60000 })
      assert.equal(run.status, 0, run.stderr)
      assert.equal(run.stdout.trim(), "[1,2]")
    }
  })
}
