// A module body's compatibility declaration is written beside its file's sidecar.
// rule-evidence: docs/design/vips/0040-module-declarations.md#41699fff05dc8475
// When the file's VIP-27 sidecar `main.d.vibe.ts` refers to the body, `main.vibe.parse.d.ts` is also written beside that sidecar, so stock `tsc` resolves the sidecar's relative import from the sidecar's actual location: beside `main.vibe` by default, or at the mirrored path under `vibe.sidecarDir` ([VIP-27](0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01)).
// rule-evidence: docs/design/vips/0040-module-declarations.md#ebfe543fe5da7db6
// That copy is a compatibility declaration, an emit output as the sidecar is ([VIP-27](0027-declaration-output.md#amendment-native-overwrite-protection-2026-11-02)): `include` and default-glob discovery leave it out while `main.vibe` declares the body, as a sibling `main.vibe.parse.ts` would, and a rebuild regenerates it; listed explicitly in `files`, it stays an input, and the write reports `TS5055`.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const vibelang = process.env.VIBELANG_BINARY
const modules = process.env.EFFECT_NODE_MODULES
assert.ok(vibelang && modules, "VIBELANG_BINARY and EFFECT_NODE_MODULES name this workspace's compiler and dependencies")
const tsc = join(modules, "typescript/bin/tsc")

function run(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  assert.equal(r.signal, null, r.stdout + r.stderr)
  return { status: r.status, output: r.stdout + r.stderr }
}

function config(dir, vibe, selection) {
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "es2022", module: "nodenext", types: [], noEmit: true },
    vibe: { effectGlobals: false, effectModules: false, ...vibe }, ...selection
  }))
}

// Stock tsc reads the sidecar from where it sits, with no .vibe file in sight:
// the body's exported types arrive, so a wrong use is an error.
function stock(dir) {
  const consumer = join(root, "consumer")
  rmSync(consumer, { recursive: true, force: true })
  mkdirSync(consumer)
  for (const name of ["main.d.vibe.ts", "main.vibe.parse.d.ts", "shape.d.vibe.ts"]) writeFileSync(join(consumer, name), readFileSync(join(dir, name)))
  writeFileSync(join(consumer, "package.json"), '{"type":"module"}')
  const check = text => {
    writeFileSync(join(consumer, "use.ts"), 'import { port, side } from "./main.vibe"\n' + text + "\n")
    return run(process.execPath, [tsc, "--strict", "--noEmit", "--target", "es2022", "--module", "nodenext", "--allowArbitraryExtensions", "use.ts"], consumer)
  }
  const good = check('export const n: number = port("1") + side({ side: 2 })')
  assert.equal(good.status, 0, good.output)
  const bad = check('export const s: string = port("1")')
  assert.match(bad.output, /use\.ts\(2,14\): error TS2322/, bad.output)
}

const root = mkdtempSync(join(tmpdir(), "vip40-body-sidecar-"))
const project = join(root, "project")
try {
  mkdirSync(project)
  writeFileSync(join(project, "package.json"), '{"type":"module"}')
  writeFileSync(join(project, "shape.vibe"), "export interface Shape { readonly side: number }\n")
  writeFileSync(join(project, "main.vibe"), [
    "module parse {",
    '  import type { Shape } from "./shape.vibe"',
    "  export function port(raw: string): number { return Number(raw) }",
    "  export function side(shape: Shape): number { return shape.side }",
    "}",
    "export { port, side } from parse",
    ""
  ].join("\n"))
  const conventional = ".vibe/declarations"
  const layouts = [["beside", {}, project], [conventional, { sidecarDir: conventional }, join(project, conventional)], ["beside", {}, project], ["types", { sidecarDir: "types" }, join(project, "types")]]
  let previous
  for (const [name, vibe, dir] of layouts) {
    // Default-glob discovery, built twice: the copy is never an input.
    config(project, vibe, {})
    for (const round of [1, 2]) {
      const r = run(vibelang, ["-p", "tsconfig.json", "--pretty", "false"], project)
      assert.equal(r.status, 0, name + " round " + round + "\n" + r.output)
    }
    assert.match(readFileSync(join(dir, "main.d.vibe.ts"), "utf8"), /from "\.\/main\.vibe\.parse\.js"/, name)
    assert.match(readFileSync(join(dir, "main.vibe.parse.d.ts"), "utf8"), /export declare function port\(raw: string\): number/, name)
    // Switching layouts removes the body's old copy wherever it removes the
    // old sidecar: beside the source, and in the conventional directory.
    if (previous && previous !== dir) {
      assert.ok(!existsSync(join(previous, "main.d.vibe.ts")), name + ": stale sidecar in " + previous)
      assert.ok(!existsSync(join(previous, "main.vibe.parse.d.ts")), name + ": stale copy in " + previous)
    }
    if (dir !== project) assert.ok(!existsSync(join(project, "main.vibe.parse.d.ts")), name + ": copy beside the source")
    stock(dir)
    // include discovery leaves it out as well.
    config(project, vibe, { include: ["**/*"] })
    const included = run(vibelang, ["-p", "tsconfig.json", "--pretty", "false", "--listFilesOnly"], project)
    assert.equal(included.status, 0, included.output)
    assert.doesNotMatch(included.output, /main\.vibe\.parse\.d\.ts/, name)
    // Listed explicitly, it stays an input and the write is refused.
    const listed = join(dir, "main.vibe.parse.d.ts")
    const bytes = readFileSync(listed, "utf8")
    config(project, vibe, { files: ["main.vibe", join(dir.slice(project.length + 1), "main.vibe.parse.d.ts")] })
    const refused = run(vibelang, ["-p", "tsconfig.json", "--pretty", "false"], project)
    assert.equal(refused.status, 1, refused.output)
    assert.match(refused.output, /error TS5055/, refused.output)
    assert.equal(readFileSync(listed, "utf8"), bytes)
    previous = dir
  }
} finally { rmSync(root, { recursive: true, force: true }) }
console.log("module body declarations sit beside their sidecars")
