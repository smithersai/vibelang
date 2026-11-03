import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// dprint formats .vibe files through the vibelang package's process plugin,
// npm:vibelang/dprint-plugin.json, which runs the native compiler. These tests
// need a native build (sh scripts/build-vibelang.sh) and a dprint binary in
// VIBELANG_DPRINT; dprint downloads its TypeScript plugin once and caches it.
const native = fileURLToPath(new URL("../native/vibelang", import.meta.url))
const dprint = process.env.VIBELANG_DPRINT
const skip = !dprint ? "set VIBELANG_DPRINT to a dprint binary" : !existsSync(native) ? "run sh scripts/build-vibelang.sh" : false

const config = {
  includes: ["**/*.{ts,vibe,vibex}"],
  excludes: ["node_modules"],
  indentWidth: 2,
  lineWidth: 120,
  newLineKind: "lf",
  typescript: { semiColons: "asi", quoteStyle: "alwaysDouble", trailingCommas: "never", operatorPosition: "maintain", "arrowFunction.useParentheses": "force" },
  plugins: [
    "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a",
    "npm:vibelang/dprint-plugin.json"
  ]
}

// project makes a project whose node_modules/vibelang is this package with a
// freshly written dprint plugin, and writes files into it.
function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-dprint-"))
  const vibelang = join(dir, "node_modules", "vibelang")
  mkdirSync(vibelang, { recursive: true })
  copyFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), join(vibelang, "package.json"))
  const written = spawnSync(native, ["--write-dprint-plugin", vibelang], { encoding: "utf8" })
  assert.equal(written.status, 0, written.stderr)
  writeFileSync(join(dir, "dprint.json"), JSON.stringify(config, null, 2))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

const run = (dir, ...args) => spawnSync(dprint, args, { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } })

test("dprint check fails on an unformatted .vibe file and dprint fmt formats it", { skip }, () => {
  const dir = project({
    "a.vibe": "function f(): string!Gone {\n    return withSpan('x') { return g() catch (e) => match (e) { when Gone: \"g\"; } }\n}\n",
    "b.ts": "export const b = 1\n"
  })
  try {
    const check = run(dir, "check")
    assert.equal(check.status, 20, check.stdout + check.stderr)
    assert.match(check.stdout + check.stderr, /a\.vibe/)
    assert.doesNotMatch(check.stdout + check.stderr, /b\.ts/)
    const fmt = run(dir, "fmt")
    assert.equal(fmt.status, 0, fmt.stdout + fmt.stderr)
    assert.equal(readFileSync(join(dir, "a.vibe"), "utf8"),
      "function f(): string!Gone {\n  return withSpan(\"x\") {\n    return g() catch (e) => match (e) { when Gone: \"g\"; }\n  }\n}\n")
    const again = run(dir, "check")
    assert.equal(again.status, 0, again.stdout + again.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("dprint formats a module declaration's body as TypeScript and keeps identifier specifiers", { skip }, () => {
  const dir = project({
    "m.vibe": "import { clean } from text\nimport { suffix } from './suffix.ts'\n\nmodule text {\nimport { b } from './b.ts'\nimport { a } from \"a\"\nexport function clean(value: string): string { return value.trim() + a + b }\n}\n\nexport * from text\nexport function tidy(value: string): string!! { return sync(() => clean(value) + suffix) }\n"
  })
  try {
    const fmt = run(dir, "fmt")
    assert.equal(fmt.status, 0, fmt.stdout + fmt.stderr)
    assert.equal(readFileSync(join(dir, "m.vibe"), "utf8"),
      "import { clean } from text\nimport { suffix } from \"./suffix.ts\"\n\nmodule text {\n  import { b } from \"./b.ts\"\n  import { a } from \"a\"\n  export function clean(value: string): string {\n    return value.trim() + a + b\n  }\n}\n\nexport * from text\nexport function tidy(value: string): string!! {\n  return sync(() => clean(value) + suffix)\n}\n")
    const again = run(dir, "check")
    assert.equal(again.status, 0, again.stdout + again.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("dprint reports a syntax error in a module body and leaves the file alone", { skip }, () => {
  const broken = "module text {\n  error Bad { reason: string }\n}\n"
  const dir = project({ "broken.vibe": broken })
  try {
    const fmt = run(dir, "fmt")
    assert.notEqual(fmt.status, 0)
    assert.match(fmt.stdout + fmt.stderr, /broken\.vibe/)
    assert.match(fmt.stdout + fmt.stderr, /vibelang format: 2:3: module text: Unexpected keyword or identifier/)
    assert.equal(readFileSync(join(dir, "broken.vibe"), "utf8"), broken)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("dprint reports a .vibe file the formatter cannot read and leaves it alone", { skip }, () => {
  const broken = "const v = (\n"
  const dir = project({ "broken.vibe": broken })
  try {
    const fmt = run(dir, "fmt")
    assert.notEqual(fmt.status, 0)
    assert.match(fmt.stdout + fmt.stderr, /broken\.vibe/)
    assert.match(fmt.stdout + fmt.stderr, /vibelang format: 1:12: Expression expected/)
    assert.equal(readFileSync(join(dir, "broken.vibe"), "utf8"), broken)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import { vibexSource } from "./vibex-format-fixture.mjs"
test("dprint discovers .vibex and routes its projection to TSX", { skip }, () => {
  const dir = project({ "view.vibex": vibexSource })
  try {
    const check = run(dir, "check")
    assert.equal(check.status, 20, check.stdout + check.stderr)
    const result = run(dir, "fmt")
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const formatted = readFileSync(join(dir, "view.vibex"), "utf8")
    assert.match(formatted, /<T,>/)
    assert.match(formatted, /\/\* c \*\//)
    assert.match(formatted, /&amp;/)
    assert.equal(run(dir, "check").status, 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
