// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | Keep existing parentheses, written default slots and the `Effect` namespace binding; otherwise refuse.
// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | Emitted declarations already use `Effect.Effect<…>` and stay unchanged.
// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation | A rewrite that can't preserve types, behavior and declaration output refuses at that site.
// The EK4856 repair of the retired global Effect alias keeps the parentheses
// and default slots the source wrote, refuses where the Effect namespace is
// shadowed while the rest of the project is fixed, and the declarations
// before and after the repair are byte-identical.
// run-seconds: 360
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
// A fresh project holding files, with the case's effect and vibelang-runtime.
function project(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" },
    include: ["*.vibe"]
  }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  return root
}
function tsc(root, flags) {
  const r = spawnSync(binary, [...flags, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
const read = (root, name) => readFileSync(join(root, name), "utf8")

const sources = {
  "main.vibe": [
    "export let paren: (Effect<number>)[]",
    "export let slots: Effect<number, never, never>",
    "export let plain: Effect<string, Error>",
    "export let union: Effect<number | string>",
    ""
  ].join("\n"),
  "shadow.vibe": [
    "export namespace Local {",
    "  namespace Effect { export const marker = 1 }",
    "  export const marker = Effect.marker",
    "  export let union: Effect<number | string>",
    "}",
    ""
  ].join("\n")
}
try {
  for (const flags of [["--fix", "--fix-migration-only"], ["--fix"]]) {
    const root = project("w02-ek4856-", sources)
    const before = tsc(root, [])
    assert.equal(before.status, 0, before.output)
    assert.equal((before.output.match(/warning EK4856:/g) || []).length, 5, before.output)
    assert.match(before.output, /shadow\.vibe\(4,21\): warning EK4856:[^\n]*\n\s*The Effect namespace is shadowed here/)
    const declarations = { main: read(root, "out/main.d.ts"), shadow: read(root, "out/shadow.d.ts") }
    // The legacy alias already emits the qualified Effect type.
    assert.match(declarations.main, /paren: \(Effect\.Effect<number>\)\[\];/)
    assert.match(declarations.main, /slots: Effect\.Effect<number, never, never>;/)
    assert.match(declarations.shadow, /union: Effect\.Effect<number \| string>;/)

    const fixed = tsc(root, flags)
    assert.equal(fixed.status, 0, fixed.output)
    if (flags.length === 1) assert.match(fixed.output, /refused site: shadow\.vibe:4:21[^\n]*EK4856[^\n]*The Effect namespace is shadowed here/, fixed.output)
    assert.equal(read(root, "shadow.vibe"), sources["shadow.vibe"], "the shadowed site is refused, not rewritten")
    const main = read(root, "main.vibe")
    assert.match(main, /^export let paren: \(Effect\.Effect<number>\)\[\]$/m, "existing parentheses stay\n" + main)
    assert.match(main, /^export let slots: number!never!never$/m, "written default slots stay\n" + main)
    assert.match(main, /^export let plain: string!Error$/m, main)
    if (flags.length === 2) assert.match(main, /^export let union: Effect\.Effect<number \| string>$/m, "a union would need new parentheses, so the repair qualifies it\n" + main)

    const after = tsc(root, [])
    assert.equal(after.status, 0, after.output)
    assert.equal((after.output.match(/warning EK4856:/g) || []).length, 1, "only the refused site still warns\n" + after.output)
    assert.match(after.output, /shadow\.vibe\(4,21\): warning EK4856:[^\n]*\n\s*The Effect namespace is shadowed here/, after.output)
    assert.equal(read(root, "out/main.d.ts"), declarations.main, flags.join(" ") + ": declarations stay unchanged")
    assert.equal(read(root, "out/shadow.d.ts"), declarations.shadow)
  }
  console.log("legacy alias repair preserves")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
