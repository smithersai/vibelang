// Coverage census: realpath versus preserveSymlinks checks nominal class identities.
// VIP-27 realpath versus preserveSymlinks checks nominal class identities: docs/design/vips/0027-declaration-output.md#c54178b32febf50e
// VIP-27 realpath versus preserveSymlinks checks nominal class identities: docs/design/vips/0027-declaration-output.md#9e58280d2bd3310b
// VIP-27 realpath versus preserveSymlinks checks nominal class identities: docs/design/vips/0027-declaration-output.md#e3edd4b29e148dbc
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const stock = join(modules, "typescript/bin/tsc")
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }

function workspaceIdentity({ output = ".vibe/declarations", config = "tsconfig.json", preserveSymlinks = false, external = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-relocated-identity-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    const directory = external ? join(root, "declarations") : join(root, "a", output)
    const sidecar = join(directory, "src/Stage.d.vibe.ts")
    put("a/package.json", JSON.stringify({ name: "producer", version: "1.0.0", type: "module", types: sidecar, main: "./src/Stage.vibe" }))
    put("a/" + config, JSON.stringify({ compilerOptions: options, include: ["src"], vibe: { sidecarDir: external ? directory : output } }))
    put("a/src/Stage.vibe", "export class Stage { private readonly brand = 1; constructor(readonly name: string) {} }\n")
    mkdirSync(dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, "export declare class Stage { private readonly brand; readonly name: string; constructor(name: string); }\n")
    put("a/src/Use.ts", 'import { Stage } from "./Stage.vibe"; export const use = (s: Stage): string => s.name;\n')
    put("b/package.json", '{"type":"module"}')
    put("b/tsconfig.json", JSON.stringify({ compilerOptions: { ...options, preserveSymlinks }, include: ["src"] }))
    put("b/src/main.ts", 'import { Stage } from "producer"; import { use } from "producer/src/Use.js"; export const run = (s: Stage): string => use(s);\n')
    mkdirSync(join(root, "b/node_modules"), { recursive: true })
    symlinkSync(join(root, "a"), join(root, "b/node_modules/producer"))
    const checked = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: join(root, "b"), encoding: "utf8" })
    if (preserveSymlinks) {
      // Detail 285: logical node_modules paths retain native TypeScript identity.
      assert.equal(checked.status, 2, checked.stdout + checked.stderr)
      assert.match(checked.stdout, /TS2345/, checked.stdout)
      assert.doesNotMatch(checked.stdout, /TS2307/, checked.stdout)
    } else assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a workspace's relocated sidecar and explicit Vibe source keep one private class identity", () => { workspaceIdentity() })

test("preserveSymlinks retains separate logical declaration and source identities", () => { workspaceIdentity({ preserveSymlinks: true }) })

test("property: workspace sidecar views preserve effective mapping and native symlink identity", { timeout: 600000 }, () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-sidecar-private-identity.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.record({
    output: fc.constantFrom(".vibe/declarations", "types", "gen/out"),
    config: fc.constantFrom("tsconfig.json", "vibe.config.json", "tsconfig.build.json"),
    preserveSymlinks: fc.boolean(),
    external: fc.boolean()
  }), input => { workspaceIdentity(input) }), { examples: [[corpus.input]], seed: 36268, numRuns: Number(process.env.FC_RUNS || 12) })
})

