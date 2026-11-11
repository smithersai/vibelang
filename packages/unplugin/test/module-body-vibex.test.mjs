// VIP-40: every bundler serves a .vibex module's module declarations as it
// serves a .vibe module's: each body under the compiler's canonical filename,
// main.vibex.<encoded name>.js, from the compiled parent. Builds a .vibex
// parent with webpack, Rspack, Rollup, Rolldown, esbuild, Bun and Vite through
// build.mjs, then runs the bundle. Run test/run.sh, which links the fixtures'
// node_modules.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runChild } from "./child.mjs"

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const rule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."
const here = fileURLToPath(new URL(".", import.meta.url))
const build = join(here, "build.mjs")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const bundles = { webpack: "out/main.cjs", rspack: "out/main.cjs", rollup: "out/main.js", rolldown: "out/main.js", esbuild: "out/main.js", bun: "out/main.js", vite: "out/main.js" }

// Names that keep, encode or mix characters: Text -> -54-ext, Über -> -dc-ber, $x -> -24-x.
const parent = [
  "module Über { export const n = 1 }",
  "module $x { export const n = 2 }",
  "module Text { export const n = 3 }",
  "module snake_case9 { export const n = 4 }",
  "import { n as a } from Über",
  "import { n as b } from $x",
  "import { n as c } from Text",
  "import { n as d } from snake_case9",
  "export const all: number[] = [a, b, c, d]",
  ""
].join("\n")

for (const [bundler, bundle] of Object.entries(bundles)) {
  test(`${bundler} bundles each module declaration of a .vibex module under the compiler's canonical filename (VIP-40)`, { skip: bundler === "bun" && !hasBun && "Bun is required" }, async (t) => {
    assert.ok(rule.includes("unplugin"))
    // Fixtures share test/.fixtures/node_modules, which run.sh links.
    const root = await mkdtemp(join(here, ".fixtures", `vibex-bodies-${bundler}-`))
    t.after(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, "src"))
    await writeFile(join(root, "package.json"), '{ "name": "vibex-bodies", "private": true, "type": "module" }\n')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
        jsx: "react-jsx", rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true },
      include: ["src/*.vibex", "src/*.ts"]
    }))
    await writeFile(join(root, "src/names.vibex"), parent)
    await writeFile(join(root, "src/main.ts"), 'import { all } from "./names.vibex"\nconsole.log(JSON.stringify(all))\n')
    const runtime = bundler === "bun" ? "bun" : process.execPath
    const built = await runChild(runtime, ["--no-warnings", build, bundler], { cwd: root })
    assert.equal(built.code, 0, built.stdout + built.stderr)
    const ran = await runChild(runtime, [bundle], { cwd: root })
    assert.equal(ran.code, 0, ran.stderr)
    assert.equal(ran.stdout.trim(), "[1,2,3,4]")
  })
}
